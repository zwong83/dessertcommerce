import type { QueryResult, QueryResultRow } from "pg";

export interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<Pick<QueryResult<Row>, "rows" | "rowCount">>;
}

interface TransactionClient extends Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<Pick<QueryResult<Row>, "rows" | "rowCount" | "command">>;
  release(destroy?: boolean): void;
}

export interface TransactionPool {
  connect(): Promise<TransactionClient>;
}

export async function withTransaction<T>(
  pool: TransactionPool,
  run: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let reusable = false;

  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    try {
      const result = await run(client);
      const commit = await client.query("COMMIT");
      if (commit.command !== "COMMIT") {
        throw new Error("PostgreSQL did not commit the transaction");
      }
      reusable = true;
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
        reusable = true;
      } catch {
        // Discard the connection and preserve the original transaction error.
      }
      throw error;
    }
  } finally {
    client.release(!reusable);
  }
}
