// Runs before `npm test`. Creates the separate test database once, so tests never touch
// the development data in `aguda`.
import pg from "pg";

const admin = new pg.Client({
  connectionString: "postgres://aguda:localdev@127.0.0.1:5433/aguda",
});
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'aguda_test'");
if (exists.rowCount === 0) await admin.query("CREATE DATABASE aguda_test");
await admin.end();
