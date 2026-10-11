/**
 * Request 24. Two kinds of employee. A manager comes from MANAGERS in .env. A worker is a
 * row in `workers`, which managers add and remove. Both use the staff login page and the
 * distribution desk; only a manager opens the manager page.
 */
import { pool } from "./db.ts";

export type Role = "manager" | "worker";

/**
 * The role of a staff email now, or null if it is neither. The server asks on every staff
 * request, not only at login, so a removed worker loses access on the next click.
 */
export async function roleOf(email: string, managers: string[]): Promise<Role | null> {
  const e = email.toLowerCase();
  if (managers.includes(e)) return "manager";
  const r = await pool.query("SELECT 1 FROM workers WHERE email = $1", [e]);
  return r.rowCount ? "worker" : null;
}

export async function listWorkers(): Promise<string[]> {
  const r = await pool.query("SELECT email FROM workers ORDER BY email");
  return r.rows.map((row) => row.email);
}

export type AddWorkerResult = { ok: true } | { ok: false; reason: "invalid" | "wrong_domain" | "manager" | "exists" };

/** Staff log in with a university or an Aguda account, so a worker needs one of those. */
export async function addWorker(email: string, staffDomains: string[], managers: string[]): Promise<AddWorkerResult> {
  const e = email.trim().toLowerCase();
  const domain = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(e)?.[1];
  if (!domain) return { ok: false, reason: "invalid" };
  if (!staffDomains.includes(domain)) return { ok: false, reason: "wrong_domain" };
  if (managers.includes(e)) return { ok: false, reason: "manager" };
  const r = await pool.query("INSERT INTO workers (email) VALUES ($1) ON CONFLICT DO NOTHING", [e]);
  return r.rowCount ? { ok: true } : { ok: false, reason: "exists" };
}

export async function removeWorker(email: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM workers WHERE email = $1", [email.trim().toLowerCase()]);
  return r.rowCount === 1;
}

export type SetStockResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unknown_gift" }
  | { ok: false; reason: "below_requested"; min: number };

/**
 * A manager sets a gift's starting inventory. The new number can never fall below the
 * students who already selected the gift. The rule sits in the WHERE clause, so a
 * selection that lands at the same moment cannot slip under it, and the CHECK on `gifts`
 * backs it up.
 */
export async function setStock(giftId: number, value: string): Promise<SetStockResult> {
  if (!/^\d{1,6}$/.test(value.trim())) return { ok: false, reason: "invalid" };
  const n = Number(value.trim());
  const r = await pool.query(
    "UPDATE gifts SET starting_inventory = $2 WHERE id = $1 AND requested_count <= $2",
    [giftId, n],
  );
  if (r.rowCount) return { ok: true };
  const g = await pool.query("SELECT requested_count FROM gifts WHERE id = $1", [giftId]);
  if (!g.rowCount) return { ok: false, reason: "unknown_gift" };
  return { ok: false, reason: "below_requested", min: g.rows[0].requested_count };
}
