import { pool } from "./db.ts";

// Wait up to 30 seconds for the local PostgreSQL container to accept connections.
for (let attempt = 1; attempt <= 60; attempt++) {
  try {
    await pool.query("SELECT 1");
    console.log("database ready");
    break;
  } catch {
    if (attempt === 60) throw new Error("database did not start within 30 seconds");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
await pool.end();
