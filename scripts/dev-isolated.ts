import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { databaseUrl, pythonInterpreter, startPython, waitForExit } from "./python-runtime";
import { freeLoopbackPort, startTestPostgres } from "../tests/postgres-harness";

const persistent = process.argv.includes("--persistent");
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

async function main() {
  const {
    SWEETCOMMERCE_MIGRATION_DATABASE_URL: migrationDsn,
    DATABASE_URL: apiDsn,
    SWEETCOMMERCE_WORKER_DATABASE_URL: workerDsn,
    SWEETCOMMERCE_IDENTITY_KEY: savedIdentityKey,
    ...environment
  } = process.env;
  const identityKey = persistent ? savedIdentityKey : randomBytes(32).toString("base64url");
  if (!identityKey || !/^[A-Za-z0-9_-]{43}$/.test(identityKey)) {
    throw new Error("A stable local identity key is required.");
  }

  const db = persistent ? undefined : await startTestPostgres({ applyMigrations: false });
  try {
    const port = Number(process.env.SWEETCOMMERCE_LOCAL_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");

    const migrationUrl = db ? databaseUrl(db.migration) : localDatabaseUrl(migrationDsn, "sweetcommerce_migration");
    const apiUrl = db ? databaseUrl(db.api) : localDatabaseUrl(apiDsn, "sweetcommerce_api");
    const workerUrl = db ? databaseUrl(db.worker) : localDatabaseUrl(workerDsn, "sweetcommerce_worker");
    if (persistent && process.platform === "win32" && ["", "5432"].includes(new URL(migrationUrl).port)) {
      const postgres = spawn(pythonInterpreter(), [
        "-B", fileURLToPath(new URL("./setup-local-postgres.py", import.meta.url)), "--start-only",
      ], { env: environment, stdio: "inherit" });
      if (await waitForExit(postgres)) throw new Error("Cannot start local PostgreSQL.");
    }
    const migration = startPython("sweetcommerce.migrate", [], {
      ...environment, SWEETCOMMERCE_MIGRATION_DATABASE_URL: migrationUrl,
    });
    if (await waitForExit(migration)) throw new Error("Cannot migrate the local database.");

    if (db) {
      const product = randomUUID();
      await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'ADMIN',$2)", [randomUUID(), "+60000000001"]);
      await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'CUSTOMER',$2)", [randomUUID(), "+60000000002"]);
      await db.api.query("INSERT INTO product (id,name,category,status) VALUES ($1,'Sample chocolate tart','Sample desserts','LISTED')", [product]);
      await db.api.query(
        "INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes) VALUES ($1,$2,'Mini','Chocolate',true,450,30)",
        [randomUUID(), product],
      );
      await db.api.query("INSERT INTO operating_policy (open_weekdays,opens_at,closes_at) VALUES (ARRAY[1,2,3,4,5,6,7]::smallint[],'06:00','22:00')");
      await db.api.query(`
        INSERT INTO capacity_day (service_date,closed,max_units)
        SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + day, FALSE, 30
        FROM generate_series(0, 7) day
      `);
    }

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
  } finally {
    await db?.close();
  }
}

main().catch(() => {
  process.stderr.write("The local development environment could not start.\n");
  process.exitCode = 1;
});
