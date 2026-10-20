/**
 * Requests 24, 25, 28, and 29. Every employee is a row in `staff`, with one of three roles,
 * each with everything of the role below it:
 *
 *   worker   the distribution desk
 *   manager  also the manager page: add staff, remove workers, set the stock
 *   ceo      (מנכ"ל) also download the data. Only a ceo or the command line adds a ceo,
 *            because a ceo can read every student's details
 *
 * The command line, at the end of this file, adds the first manager or ceo, and removes
 * managers and ceos.
 */
import { pool } from "./db.ts";

export type Role = "worker" | "manager" | "ceo";
export const RANK: Record<Role, number> = { worker: 0, manager: 1, ceo: 2 };
const isRole = (value: string): value is Role => value in RANK;
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

/** The highest role first, then by email. */
export async function listStaff(): Promise<StaffMember[]> {
  const r = await pool.query("SELECT email, role FROM staff");
  return (r.rows as StaffMember[]).sort((a, b) => RANK[b.role] - RANK[a.role] || a.email.localeCompare(b.email));
}

/** A lowercase email whose domain is one of `staffDomains`, or the reason it is not. */
function checkEmail(email: string, staffDomains: string[]): { ok: true; email: string } | { ok: false; reason: "invalid" | "wrong_domain" } {
  const e = email.trim().toLowerCase();
  const domain = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(e)?.[1];
  if (!domain) return { ok: false, reason: "invalid" };
  if (!staffDomains.includes(domain)) return { ok: false, reason: "wrong_domain" };
  return { ok: true, email: e };
}

export type AddStaffResult =
  | { ok: true; done: `added_${Role}` | "promoted_manager" | "promoted_ceo" }
  | { ok: false; reason: "invalid" | "wrong_domain" | "exists" | "higher" | "invalid_role" | "forbidden_role" };

/**
 * A manager or a ceo adds staff (requests 28 and 29). Adding a person who already has a
 * lower role raises the role, in one statement. Nothing here lowers a role. Only a ceo may
 * give the ceo role. Staff log in with a university or an Aguda account, so the address
 * needs one of those.
 */
export async function addStaff(email: string, role: string, staffDomains: string[], by: Role): Promise<AddStaffResult> {
  if (!isRole(role)) return { ok: false, reason: "invalid_role" };
  if (role === "ceo" && by !== "ceo") return { ok: false, reason: "forbidden_role" };
  const checked = checkEmail(email, staffDomains);
  if (!checked.ok) return checked;

  // Insert, or raise a lower role. xmax = 0 marks an insert.
  const r = await pool.query(
    `INSERT INTO staff (email, role) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET role = excluded.role
       WHERE (CASE staff.role WHEN 'worker' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END) < $3
     RETURNING xmax = 0 AS inserted`,
    [checked.email, role, RANK[role]],
  );
  if (r.rowCount) return { ok: true, done: r.rows[0].inserted ? `added_${role}` : role === "ceo" ? "promoted_ceo" : "promoted_manager" };
  return { ok: false, reason: (await roleOf(checked.email)) === role ? "exists" : "higher" };
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
//   npm run staff -- manager <email>         add a manager, or set an existing person's role to manager
//   npm run staff -- ceo <email>             add a ceo, or set an existing person's role to ceo
//   npm run staff -- remove <email>          remove anyone
// On the server: bash /home/opc/aguda/app/deploy/server.sh staff manager <email>

if (import.meta.main) {
  const [command, email = ""] = process.argv.slice(2);
  const domains = (process.env.STAFF_DOMAINS ?? "mail.huji.ac.il,aguda.org.il").split(",").map((d) => d.trim().toLowerCase());
  let code = 0;
  if (command === "manager" || command === "ceo") {
    const checked = checkEmail(email, domains);
    if (checked.ok) {
      await pool.query(
        "INSERT INTO staff (email, role) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET role = excluded.role",
        [checked.email, command],
      );
      console.log(`${checked.email} is a ${command}`);
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
    console.error("usage: npm run staff -- [manager <email> | ceo <email> | remove <email>]");
    code = 1;
  }
  await pool.end();
  process.exit(code);
}
