import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type TransactionPool, withTransaction } from "./index";

const migrations = [
  { version: 1, file: new URL("../../../db/migrations/0001-standard-ordering.sql", import.meta.url) },
];

// A cluster admin provisions sweetcommerce_migration, sweetcommerce_api and
// sweetcommerce_worker before running this. Only the migration role creates schema objects.
export async function migrate(pool: TransactionPool): Promise<number[]> {
  const baseline = await Promise.all(migrations.map(async ({ version, file }) => {
    const sql = await readFile(file, "utf8");
    return { version, sql, digest: createHash("sha256").update(sql).digest("hex") };
  }));

  return withTransaction(pool, async (tx) => {
    const { rows: [server] } = await tx.query<{ major: number; role: string }>(
      "SELECT current_setting('server_version_num')::integer / 10000 AS major, current_user AS role",
    );
    if (server.major !== 16 || server.role !== "sweetcommerce_migration") {
      throw new Error("Migrations require PostgreSQL 16 and the sweetcommerce_migration role");
    }

    // Every runner takes the same transaction-scoped lock before touching the migration history.
    await tx.query("SELECT pg_advisory_xact_lock(1599625048, 1)");
    await tx.query("CREATE SCHEMA IF NOT EXISTS sweetcommerce");
    await tx.query("SET LOCAL search_path TO sweetcommerce");
    await tx.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version integer PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const { rows: history } = await tx.query<{ version: number; sha256: string }>(
      "SELECT version, sha256 FROM schema_migration ORDER BY version",
    );
    for (const [index, row] of history.entries()) {
      const expected = baseline[index];
      if (!expected || expected.version !== row.version || expected.digest !== row.sha256) {
        throw new Error(`Migration history differs at version ${row.version}`);
      }
    }

    const applied: number[] = [];
    for (const migration of baseline.slice(history.length)) {
      await tx.query(migration.sql);
      await tx.query("INSERT INTO schema_migration (version, sha256) VALUES ($1, $2)", [
        migration.version, migration.digest,
      ]);
      applied.push(migration.version);
    }
    return applied;
  });
}
