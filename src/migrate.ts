import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { pool } from "./db.ts";

const dir = join(import.meta.dirname, "..", "migrations");

/** Apply every migration file in name order. Each file is idempotent. */
export async function migrate(db: pg.Pool | pg.PoolClient = pool): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.query(await readFile(join(dir, file), "utf8"));
  }
}

if (import.meta.main) {
  await migrate();
  console.log("migrations applied");
  await pool.end();
}
