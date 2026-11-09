import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const backend = fileURLToPath(new URL("../backend/", import.meta.url));
const defaultPython = fileURLToPath(new URL("../.cache/python-venv/bin/python", import.meta.url));

export function startPython(module: string, args: string[] = [], env = process.env) {
  return spawn(process.env.SWEETCOMMERCE_PYTHON ?? defaultPython, ["-B", "-m", module, ...args], {
    cwd: backend, env, stdio: "inherit",
  });
}

export function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1)));
  });
}

export function databaseUrl(pool: Pool) {
  const { user, password, host, port, database } = pool.options;
  if (host !== "127.0.0.1" || !port || !user || !database || typeof password !== "string") {
    throw new Error("Expected an isolated loopback PostgreSQL role.");
  }
  const url = new URL("postgresql://127.0.0.1");
  url.port = String(port);
  url.username = user;
  url.password = password;
  url.pathname = "/" + database;
  return url.toString();
}
