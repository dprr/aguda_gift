/**
 * Requests 24, 25, 28, 29, 31, and 32. Every employee is a row in `staff`, with one of three
 * roles, each with everything of the role below it:
 *
 *   worker   the distribution desk
 *   manager  also the manager page: add and remove workers, set the stock
 *   ceo      (מנכ"ל) also add and remove managers, and download the data
 *
 * Request 32: a person adds and removes staff strictly below their own level. So nobody
 * changes a peer or themselves on the website, and only the command line, at the end of
 * this file, adds or removes a ceo.
 */
import { pool, Rollback, transaction } from "./db.ts";

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

/** Request 32: a person acts only on roles strictly below their own. */
export const mayManage = (by: Role, target: Role) => RANK[target] < RANK[by];

/**
 * A manager or a ceo adds staff below their own level (request 32). Adding a person who
 * already has a lower role raises the role, in one statement. Nothing here lowers a role.
 * Staff log in with a university or an Aguda account, so the address needs one of those.
 */
export async function addStaff(email: string, role: string, staffDomains: string[], by: Role): Promise<AddStaffResult> {
  if (!isRole(role)) return { ok: false, reason: "invalid_role" };
  if (!mayManage(by, role)) return { ok: false, reason: "forbidden_role" };
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

export type RemoveStaffResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" | "self" };

/**
 * Request 32. A manager or a ceo removes staff strictly below their own level, so never a
 * peer and never themselves. The rule sits in the WHERE clause, so a role that changes at
 * the same moment cannot slip past it.
 */
export async function removeStaff(email: string, by: { email: string; role: Role }): Promise<RemoveStaffResult> {
  const e = email.trim().toLowerCase();
  if (e === by.email.toLowerCase()) return { ok: false, reason: "self" };
  const r = await pool.query(
    "DELETE FROM staff WHERE email = $1 AND (CASE role WHEN 'worker' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END) < $2",
    [e, RANK[by.role]],
  );
  if (r.rowCount) return { ok: true };
  return { ok: false, reason: (await roleOf(e)) ? "forbidden" : "not_found" };
}

/** Request 34: this many wrong national IDs in a row remove a staff member. */
export const MAX_FAILED_LOOKUPS = 5;

export type LookupRecord =
  | { removed: false; failed: number }
  | { removed: true; role: Role };

/**
 * Request 34. Records one desk search by a staff member. A search that finds a student
 * resets the count. A search that finds nobody adds one, and the fifth in a row removes the
 * person from the staff list, whatever the role, and adds an alert for the ceo (request 35).
 * One transaction, so two searches at the same moment cannot both read the old count.
 */
export async function recordLookup(email: string, found: boolean): Promise<LookupRecord> {
  const e = email.toLowerCase();
  if (found) {
    await pool.query("UPDATE staff SET failed_lookups = 0 WHERE email = $1 AND failed_lookups <> 0", [e]);
    return { removed: false, failed: 0 };
  }
  return transaction(async (db) => {
    const r = await db.query(
      "UPDATE staff SET failed_lookups = failed_lookups + 1 WHERE email = $1 RETURNING failed_lookups, role",
      [e],
    );
    if (!r.rowCount) throw new Rollback<LookupRecord>({ removed: false, failed: 0 });
    const { failed_lookups: failed, role } = r.rows[0];
    if (failed < MAX_FAILED_LOOKUPS) return { removed: false, failed };
    await db.query("DELETE FROM staff WHERE email = $1", [e]);
    // Request 35: the ceo's alert, in the same transaction, so no removal goes unreported.
    await db.query(
      `UPDATE settings SET staff_alerts = staff_alerts
         || jsonb_build_array(jsonb_build_object('at', now(), 'email', $1::text, 'role', $2::text))`,
      [e, role],
    );
    return { removed: true, role };
  });
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
