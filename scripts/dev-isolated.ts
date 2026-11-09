import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { databaseUrl, startPython, waitForExit } from "./python-runtime";
import { freeLoopbackPort, startTestPostgres } from "../tests/postgres-harness";

const code = process.env.SWEETCOMMERCE_SYNTHETIC_OTP;
if (!code || !/^\d{6}$/.test(code)) {
  process.stderr.write("Set SWEETCOMMERCE_SYNTHETIC_OTP to a six-digit value for this isolated development session.\n");
  process.exit(1);
}

async function main() {
  const db = await startTestPostgres({ applyMigrations: false });
  try {
    const port = Number(process.env.SWEETCOMMERCE_LOCAL_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");

    const migration = startPython("sweetcommerce.migrate", [], {
      ...process.env, SWEETCOMMERCE_MIGRATION_DATABASE_URL: databaseUrl(db.migration),
    });
    if (await waitForExit(migration)) throw new Error("Cannot migrate the isolated database.");

    const product = randomUUID();
    await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'ADMIN',$2)", [randomUUID(), "+60000000001"]);
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

    const apiPort = await freeLoopbackPort();
    const origin = "http://127.0.0.1:" + port;
    const api = startPython("sweetcommerce", [], {
      ...process.env,
      NODE_ENV: "development",
      SWEETCOMMERCE_ENV: "development",
      SWEETCOMMERCE_API_PORT: String(apiPort),
      DATABASE_URL: databaseUrl(db.api),
      SWEETCOMMERCE_IDENTITY_KEY: randomBytes(32).toString("base64url"),
      SWEETCOMMERCE_ORIGIN: origin,
      SWEETCOMMERCE_OTP_MODE: "synthetic",
      SWEETCOMMERCE_SYNTHETIC_OTP: code,
    });
    const worker = startPython("sweetcommerce.worker", [], {
      ...process.env,
      SWEETCOMMERCE_ENV: "development",
      SWEETCOMMERCE_NOTICE_MODE: "synthetic",
      SWEETCOMMERCE_WORKER_DATABASE_URL: databaseUrl(db.worker),
    });
    const productionBuild = process.env.SWEETCOMMERCE_LOCAL_WEB_MODE === "production";
    const web = spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
      productionBuild ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port),
    ], {
      stdio: "inherit",
      env: {
        ...process.env,
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
    await db.close();
  }
}

main().catch(() => {
  process.stderr.write("The isolated development environment could not start.\n");
  process.exitCode = 1;
});
