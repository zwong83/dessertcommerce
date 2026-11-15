import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, Pool, type ClientConfig } from "pg";
import { migrate } from "./legacy-backend/db/migrate";
import type { OtpDelivery } from "./legacy-backend/identity/service";

const runFile = promisify(execFile);
const loopback = "127.0.0.1";
const database = "sweetcommerce_test";
const roleNames = {
  migration: "sweetcommerce_migration",
  api: "sweetcommerce_api",
  worker: "sweetcommerce_worker",
} as const;

export function databaseUrl(pool: Pool) {
  const { user, password, host, port, database } = pool.options;
  if (host !== loopback || !port || !user || !database || typeof password !== "string") {
    throw new Error("Expected an isolated loopback PostgreSQL role.");
  }
  const url = new URL("postgresql://" + loopback);
  url.port = String(port);
  url.username = user;
  url.password = password;
  url.pathname = "/" + database;
  return url.toString();
}

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, loopback, () => {
      const address = socket.address();
      socket.close((error) => {
        if (error || !address || typeof address === "string") {
          reject(error ?? new Error("Cannot allocate a PostgreSQL test port"));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

function launchPostgres(postgres: string, data: string, port: number) {
  const child = spawn(postgres, [
    "-D", data, "-p", String(port),
    "-c", `listen_addresses=${loopback}`, "-c", "unix_socket_directories=",
    "-c", "timezone=UTC",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PostgreSQL test startup timed out")), 10_000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", () => finish(new Error("Cannot start the bundled PostgreSQL binary")));
    child.once("close", (code) => finish(new Error(`PostgreSQL exited during test startup (${code})`)));
    let tail = "";
    child.stderr.setEncoding("utf8").on("data", (message: string) => {
      tail = (tail + message).slice(-1_024);
      if (tail.includes("database system is ready to accept connections")) finish();
    });
  });
  return {
    ready,
    async stop() {
      child.kill("SIGINT");
      await closed;
    },
  };
}

async function provision(config: ClientConfig, passwords: Record<keyof typeof roleNames, string>) {
  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  try {
    const { rows: [server] } = await admin.query<{
      version: string; major: number; listen: string; sockets: string;
    }>(`
      SELECT current_setting('server_version') AS version,
             current_setting('server_version_num')::integer / 10000 AS major,
             current_setting('listen_addresses') AS listen,
             current_setting('unix_socket_directories') AS sockets
    `);
    if (server.major !== 16 || server.listen !== loopback || server.sockets !== "") {
      throw new Error("Test cluster must run PostgreSQL 16 on IPv4 loopback only");
    }
    for (const key of Object.keys(roleNames) as (keyof typeof roleNames)[]) {
      const name = admin.escapeIdentifier(roleNames[key]);
      const password = admin.escapeLiteral(passwords[key]);
      // PostgreSQL role DDL takes a literal password. Every value is random and scoped to this cluster.
      try {
        await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD ${password}
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
      } catch {
        throw new Error(`Cannot create the ${key} role in the isolated PostgreSQL test cluster`);
      }
    }
    await admin.query("CREATE DATABASE sweetcommerce_test");
    await admin.query(`
      REVOKE ALL ON DATABASE sweetcommerce_test FROM PUBLIC;
      GRANT CONNECT, CREATE ON DATABASE sweetcommerce_test TO sweetcommerce_migration;
      GRANT CONNECT ON DATABASE sweetcommerce_test TO sweetcommerce_api, sweetcommerce_worker;
      ALTER ROLE sweetcommerce_migration IN DATABASE sweetcommerce_test SET search_path TO sweetcommerce;
      ALTER ROLE sweetcommerce_api IN DATABASE sweetcommerce_test SET search_path TO sweetcommerce;
      ALTER ROLE sweetcommerce_worker IN DATABASE sweetcommerce_test SET search_path TO sweetcommerce;
    `);
    return server;
  } finally {
    await admin.end();
  }
}

export function createSyntheticAdapters(initialTime = new Date("2030-01-01T00:00:00.000Z")) {
  let time = initialTime.getTime();
  const messages: Parameters<OtpDelivery["deliver"]>[0][] = [];
  const objects = new Map<string, Buffer>();
  return {
    clock: {
      now: () => new Date(time),
      advance: (milliseconds: number) => { time += milliseconds; },
    },
    otp: {
      messages,
      newCode: () => "123456",
      async deliver(input: Parameters<OtpDelivery["deliver"]>[0]) { messages.push({ ...input }); },
    },
    storage: {
      async put(key: string, bytes: Uint8Array) {
        if (objects.has(key)) throw new Error("Synthetic object already exists");
        objects.set(key, Buffer.from(bytes));
      },
      async read(key: string) {
        const bytes = objects.get(key);
        return bytes ? Buffer.from(bytes) : null;
      },
      async delete(key: string) { objects.delete(key); },
    },
  };
}

export async function startTestPostgres({ applyMigrations = true } = {}) {
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const cache = join(root, ".cache");
  await mkdir(cache, { recursive: true });
  if (await realpath(cache) !== cache) throw new Error("PostgreSQL tests require a project-local .cache");

  const require = createRequire(import.meta.url);
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const distribution = require.resolve(`@embedded-postgres/${platform}-${process.arch}`);
  const binaries = join(dirname(distribution), "..", "native", "bin");
  const directory = await mkdtemp(join(cache, "sweetcommerce-pg-"));
  const data = join(directory, "data");
  const passwordFile = join(directory, "init-password");
  const adminPassword = randomBytes(32).toString("hex");
  const passwords = {
    migration: randomBytes(32).toString("hex"),
    api: randomBytes(32).toString("hex"),
    worker: randomBytes(32).toString("hex"),
  };
  const pools: Pool[] = [];
  let cluster: ReturnType<typeof launchPostgres> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await Promise.all(pools.map((pool) => pool.end()));
    } finally {
      await cluster?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  })();

  try {
    // Use the installed distribution directly so initdb keeps its password file inside .cache.
    await writeFile(passwordFile, adminPassword + "\n", { flag: "wx", mode: 0o600 });
    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    await runFile(join(binaries, "initdb" + executableSuffix), [
      "--pgdata", data, "--username", "postgres", "--pwfile", passwordFile,
      "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C",
    ], { timeout: 20_000 });
    await unlink(passwordFile);
    const port = await freeLoopbackPort();
    cluster = launchPostgres(join(binaries, "postgres" + executableSuffix), data, port);
    await cluster.ready;

    const config = {
      host: loopback, port, ssl: false, user: "postgres", password: adminPassword,
      connectionTimeoutMillis: 3_000,
    };
    const server = await provision(config, passwords);
    const poolFor = (key: keyof typeof roleNames) => {
      const pool = new Pool({
        ...config, database, user: roleNames[key], password: passwords[key], max: 6,
      });
      pools.push(pool);
      return pool;
    };
    const migration = poolFor("migration");
    const api = poolFor("api");
    const worker = poolFor("worker");
    if (applyMigrations) await migrate(migration);
    return { migration, api, worker, server, close, ...createSyntheticAdapters() };
  } catch (error) {
    await close();
    throw error;
  }
}
