/**
 * Requests 24 and 25. Every employee is a row in `staff`, marked manager or worker. Both
 * use the staff login page and the distribution desk; only a manager opens the manager
 * page. Managers add and remove workers there. Managers themselves are added from the
 * command line, at the end of this file, so the first manager needs no screen.
 */
import { pool } from "./db.ts";

export type Role = "manager" | "worker";
export type StaffMember = { email: string; role: Role };

/**
 * The role of a staff email now, or null if it is not on the list. The server asks on
 * every staff request, not only at login, so a removed worker loses access on the next
 * click.
 */
export async function roleOf(email: string): Promise<Role | null> {
  const r = await pool.query("SELECT role FROM staff WHERE email = $1", [email.toLowerCase()]);
  return r.rows[0]?.role ?? null;
}

/** Managers first, then workers, each by email. */
export async function listStaff(): Promise<StaffMember[]> {
  const r = await pool.query("SELECT email, role FROM staff ORDER BY role = 'worker', email");
  return r.rows;
}

/** A lowercase email whose domain is one of `staffDomains`, or the reason it is not. */
function checkEmail(email: string, staffDomains: string[]): { ok: true; email: string } | { ok: false; reason: "invalid" | "wrong_domain" } {
  const e = email.trim().toLowerCase();
  const domain = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(e)?.[1];
  if (!domain) return { ok: false, reason: "invalid" };
  if (!staffDomains.includes(domain)) return { ok: false, reason: "wrong_domain" };
  return { ok: true, email: e };
}

export type AddWorkerResult = { ok: true } | { ok: false; reason: "invalid" | "wrong_domain" | "manager" | "exists" };

/** Staff log in with a university or an Aguda account, so a worker needs one of those. */
export async function addWorker(email: string, staffDomains: string[]): Promise<AddWorkerResult> {
  const checked = checkEmail(email, staffDomains);
  if (!checked.ok) return checked;
  const r = await pool.query(
    "INSERT INTO staff (email, role) VALUES ($1, 'worker') ON CONFLICT DO NOTHING",
    [checked.email],
  );
  if (r.rowCount) return { ok: true };
  return { ok: false, reason: (await roleOf(checked.email)) === "manager" ? "manager" : "exists" };
}

/** Workers only. The manager page cannot remove a manager. */
export async function removeWorker(email: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM staff WHERE email = $1 AND role = 'worker'", [email.trim().toLowerCase()]);
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

// ---- command line -----------------------------------------------------------------------
//   npm run staff                            list the staff
//   npm run staff -- manager <email>         add a manager, or make a worker a manager
//   npm run staff -- remove <email>          remove a manager or a worker
// On the server: bash /home/opc/aguda/app/deploy/server.sh staff manager <email>

if (import.meta.main) {
  const [command, email = ""] = process.argv.slice(2);
  const domains = (process.env.STAFF_DOMAINS ?? "mail.huji.ac.il,aguda.org.il").split(",").map((d) => d.trim().toLowerCase());
  let code = 0;
  if (command === "manager") {
    const checked = checkEmail(email, domains);
    if (checked.ok) {
      await pool.query(
        "INSERT INTO staff (email, role) VALUES ($1, 'manager') ON CONFLICT (email) DO UPDATE SET role = 'manager'",
        [checked.email],
      );
      console.log(`${checked.email} is a manager`);
    } else {
      console.error(`refused: ${checked.reason}. Use an address in ${domains.join(" or ")}`);
      code = 1;
    }
  } else if (command === "remove") {
    const r = await pool.query("DELETE FROM staff WHERE email = $1", [email.trim().toLowerCase()]);
    console.log(r.rowCount ? `${email} removed` : `${email} is not on the staff list`);
    code = r.rowCount ? 0 : 1;
  } else if (command === undefined) {
    for (const m of await listStaff()) console.log(`${m.role}\t${m.email}`);
  } else {
    console.error("usage: node src/staff.ts [manager <email> | remove <email>]");
    code = 1;
  }
  await pool.end();
  process.exit(code);
}
