import pg from "pg";

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://aguda:localdev@127.0.0.1:5433/aguda",
});

/** Thrown inside `transaction` to roll back and return a value instead of failing. */
export class Rollback<T> {
  readonly value: T;
  constructor(value: T) {
    this.value = value;
  }
}

/**
 * Run `work` in one transaction. Throw `new Rollback(value)` to roll back and return
 * `value`. Any other error rolls back and propagates.
 */
export async function transaction<T>(
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Rollback) return error.value as T;
    throw error;
  } finally {
    client.release();
  }
}
