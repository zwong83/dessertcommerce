import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { pythonInterpreter, startPython, syncPythonDependencies, waitForExit } from "./python-runtime";

const code = process.env.SWEETCOMMERCE_SYNTHETIC_OTP;
if (!code || !/^\d{6}$/.test(code)) {
  process.stderr.write("Set SWEETCOMMERCE_SYNTHETIC_OTP to a six-digit value for this local development session.\n");
  process.exit(1);
}

function localDatabaseUrl(value: string | undefined, role: string) {
  const url = new URL(value ?? "");
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.username !== role
      || url.pathname !== "/sweetcommerce_local" || url.search || url.hash) {
    throw new Error("Expected the local SweetCommerce database and its dedicated role.");
  }
  return url.toString();
}

function freeLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => {
        if (error || !address || typeof address === "string") {
          reject(error ?? new Error("Could not choose a port for the local API."));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function main() {
  const {
    SWEETCOMMERCE_MIGRATION_DATABASE_URL: migrationDsn,
    DATABASE_URL: apiDsn,
    SWEETCOMMERCE_WORKER_DATABASE_URL: workerDsn,
    SWEETCOMMERCE_IDENTITY_KEY: identityKey,
    ...environment
  } = process.env;
  if (!identityKey || !/^[A-Za-z0-9_-]{43}$/.test(identityKey)) {
    throw new Error("A stable local identity key is required.");
  }

  const port = Number(process.env.SWEETCOMMERCE_LOCAL_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");

  const migrationUrl = localDatabaseUrl(migrationDsn, "sweetcommerce_migration");
  const apiUrl = localDatabaseUrl(apiDsn, "sweetcommerce_api");
  const workerUrl = localDatabaseUrl(workerDsn, "sweetcommerce_worker");
  await syncPythonDependencies();
  if (process.platform === "win32" && ["", "5432"].includes(new URL(migrationUrl).port)) {
    const postgres = spawn(pythonInterpreter(), [
      "-B", fileURLToPath(new URL("./setup-local-postgres.py", import.meta.url)), "--start-only",
    ], { env: environment, stdio: "inherit" });
    if (await waitForExit(postgres)) throw new Error("Cannot start local PostgreSQL.");
  }
  const migration = startPython("sweetcommerce.migrate", [], {
    ...environment, SWEETCOMMERCE_MIGRATION_DATABASE_URL: migrationUrl,
  });
  if (await waitForExit(migration)) throw new Error("Cannot migrate the local database.");

  const apiPort = await freeLoopbackPort();
  const origin = "http://127.0.0.1:" + port;
  const api = startPython("sweetcommerce", [], {
    ...environment,
    NODE_ENV: "development",
    SWEETCOMMERCE_ENV: "development",
    SWEETCOMMERCE_API_PORT: String(apiPort),
    DATABASE_URL: apiUrl,
    SWEETCOMMERCE_IDENTITY_KEY: identityKey,
    SWEETCOMMERCE_ORIGIN: origin,
    SWEETCOMMERCE_OTP_MODE: "synthetic",
    SWEETCOMMERCE_SYNTHETIC_OTP: code,
  });
  const worker = startPython("sweetcommerce.worker", [], {
    ...environment,
    SWEETCOMMERCE_ENV: "development",
    SWEETCOMMERCE_NOTICE_MODE: "synthetic",
    SWEETCOMMERCE_WORKER_DATABASE_URL: workerUrl,
  });
  const productionBuild = process.env.SWEETCOMMERCE_LOCAL_WEB_MODE === "production";
  const web = spawn(process.execPath, [
    fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
    productionBuild ? "start" : "dev", "frontend", "--hostname", "127.0.0.1", "--port", String(port),
  ], {
    stdio: "inherit",
    env: {
      ...environment,
      NODE_ENV: productionBuild ? "production" : "development",
      NEXT_TELEMETRY_DISABLED: "1",
      SWEETCOMMERCE_API_ORIGIN: "http://127.0.0.1:" + apiPort,
    },
  });

  const children = [api, worker, web];
  const exits = children.map(waitForExit);
  const stop = () => children.forEach((child) => child.kill("SIGTERM"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await Promise.race(exits);
  } finally {
    stop();
    await Promise.allSettled(exits);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch(error => {
  const message = error instanceof Error && !(error instanceof TypeError) ? error.message : "Check the local PostgreSQL settings.";
  process.stderr.write("SweetCommerce Persistent could not start. " + message + "\n");
  process.exitCode = 1;
});
