/**
 * Requests 24, 25, 28, 29, 31, and 32. Every employee is a row in `staff`, with one of three
 * roles, each with everything of the role below it:
 *
 *   worker   the distribution desk
 *   manager  also the manager page: add and remove workers, set the stock
 *   ceo      (מנכ"ל) also add and remove managers, and download the data
 *
 * Request 32: a person adds and removes staff strictly below their own level. So nobody
 * changes a peer or themselves on the website.
 *
 * Request 56: the ceos are a fixed list, CEO_EMAILS in .env, read at start (setCeos). Nobody
 * adds or removes a ceo, on the website or the command line. A ceo is never a row in
 * `staff`; if a listed email also has a row, the list wins.
 */
import { type Campus, isCampus } from "./campus.ts";
import { pool, Rollback, transaction } from "./db.ts";

export type Role = "worker" | "manager" | "ceo";
export const RANK: Record<Role, number> = { worker: 0, manager: 1, ceo: 2 };
const isRole = (value: string): value is Role => value in RANK;
/** Request 41: a staff member's campus. Null means all campuses (request 45); a ceo always has null. */
export type StaffMember = { email: string; role: Role; campus: Campus | null };
/** The person acting, as the session and the staff table give them. */
export type Actor = StaffMember;

let ceoEmails: string[] = [];
/** Request 56: set the fixed ceo list, once, at start. */
export function setCeos(emails: string[]): void {
  ceoEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export const isCeo = (email: string) => ceoEmails.includes(email.trim().toLowerCase());

/**
 * The role of a staff email now, or null if it is not on the list. The server asks on
 * every staff request, not only at login, so a removed worker loses access on the next
 * click.
 */
export async function staffOf(email: string): Promise<StaffMember | null> {
  if (isCeo(email)) return { email: email.toLowerCase(), role: "ceo", campus: null };
  const r = await pool.query("SELECT email, role, campus FROM staff WHERE email = $1", [email.toLowerCase()]);
  return r.rows[0] ?? null;
}

export async function roleOf(email: string): Promise<Role | null> {
  return (await staffOf(email))?.role ?? null;
}

/**
 * The staff a viewer sees: a ceo, everyone; a manager, their own campus (request 41).
 * The highest role first, then by campus and email.
 */
export async function listStaff(campus: string | null = null): Promise<StaffMember[]> {
  const r = await pool.query("SELECT email, role, campus FROM staff WHERE $1::text IS NULL OR campus = $1", [campus]);
  // The fixed ceos belong to no campus, so a one-campus view does not list them.
  const ceos: StaffMember[] = campus === null ? ceoEmails.map((email) => ({ email, role: "ceo", campus: null })) : [];
  return [...ceos, ...(r.rows as StaffMember[]).filter((m) => !isCeo(m.email))].sort((a, b) =>
    RANK[b.role] - RANK[a.role] || (a.campus ?? "").localeCompare(b.campus ?? "") || a.email.localeCompare(b.email));
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
  | { ok: true; done: "added_worker" | "added_manager" | "promoted_manager" | "moved" }
  | {
      ok: false;
      reason: "invalid" | "wrong_domain" | "exists" | "higher" | "invalid_role" | "forbidden_role"
        | "invalid_campus" | "other_campus";
    };

/** Request 32: a person acts only on roles strictly below their own. */
export const mayManage = (by: Role, target: Role) => RANK[target] < RANK[by];

/**
 * Requests 32 and 41. A manager adds workers to their own campus. A ceo adds managers and
 * workers to any campus, and moves a person to another campus by adding them again with
 * it. Adding a person who already has a lower role raises the role; nothing here lowers a
 * role, and nobody touches a person at or above their own level. Staff log in with a
 * university or an Aguda account, so the address needs one of those.
 */
export async function addStaff(
  email: string,
  role: string,
  campus: string | undefined,
  staffDomains: string[],
  by: Actor,
): Promise<AddStaffResult> {
  if (!isRole(role)) return { ok: false, reason: "invalid_role" };
  if (!mayManage(by.role, role)) return { ok: false, reason: "forbidden_role" };
  // A one-campus manager's staff join that campus. A ceo or an all-campus manager names
  // the campus, or leaves it empty for all campuses (request 45).
  const target = by.campus ?? (campus === "" || campus === undefined ? null : campus);
  if (target !== null && !isCampus(target)) return { ok: false, reason: "invalid_campus" };
  const checked = checkEmail(email, staffDomains);
  if (!checked.ok) return checked;
  if (isCeo(checked.email)) return { ok: false, reason: "higher" };

  return transaction(async (db) => {
    const r = await db.query("SELECT role, campus FROM staff WHERE email = $1 FOR UPDATE", [checked.email]);
    const old = r.rows[0] as { role: Role; campus: string | null } | undefined;
    if (!old) {
      await db.query("INSERT INTO staff (email, role, campus) VALUES ($1, $2, $3)", [checked.email, role, target]);
      return { ok: true, done: role === "manager" ? "added_manager" : "added_worker" } as AddStaffResult;
    }
    if (!mayManage(by.role, old.role) || RANK[role] < RANK[old.role]) return { ok: false, reason: "higher" } as AddStaffResult;
    if (by.campus !== null && old.campus !== by.campus) return { ok: false, reason: "other_campus" } as AddStaffResult;
    if (old.role === role && old.campus === target) return { ok: false, reason: "exists" } as AddStaffResult;
    await db.query("UPDATE staff SET role = $2, campus = $3 WHERE email = $1", [checked.email, role, target]);
    return { ok: true, done: old.role !== role ? "promoted_manager" : "moved" } as AddStaffResult;
  });
}

export type RemoveStaffResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" | "self" };

/**
 * Requests 32 and 41. A manager removes workers of their own campus; a ceo removes managers
 * and workers of any campus. Never a peer, never themselves. The rule sits in the WHERE
 * clause, so a role that changes at the same moment cannot slip past it.
 */
export async function removeStaff(email: string, by: Actor): Promise<RemoveStaffResult> {
  const e = email.trim().toLowerCase();
  if (e === by.email.toLowerCase()) return { ok: false, reason: "self" };
  if (isCeo(e)) return { ok: false, reason: "forbidden" };
  const r = await pool.query(
    `DELETE FROM staff WHERE email = $1
        AND (CASE role WHEN 'worker' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END) < $2
        AND ($3::text IS NULL OR campus = $3)`,
    [e, RANK[by.role], by.campus],
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
  // Request 56: nobody removes a ceo, so the rule does not count a ceo's searches.
  if (isCeo(e)) return { removed: false, failed: 0 };
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
 * A manager sets a gift's starting inventory on one campus (request 41). The new number can never fall below the
 * students who already selected the gift. The rule sits in the WHERE clause, so a
 * selection that lands at the same moment cannot slip under it, and the CHECK on `gifts`
 * backs it up.
 */
export async function setStock(giftId: number, campus: string, value: string): Promise<SetStockResult> {
  if (!/^\d{1,6}$/.test(value.trim())) return { ok: false, reason: "invalid" };
  const n = Number(value.trim());
  const r = await pool.query(
    "UPDATE gift_stock SET starting_inventory = $3 WHERE gift_id = $1 AND campus = $2 AND requested_count <= $3",
    [giftId, campus, n],
  );
  if (r.rowCount) return { ok: true };
  const g = await pool.query("SELECT requested_count FROM gift_stock WHERE gift_id = $1 AND campus = $2", [giftId, campus]);
  if (!g.rowCount) return { ok: false, reason: "unknown_gift" };
  return { ok: false, reason: "below_requested", min: g.rows[0].requested_count };
}

// ---- command line -----------------------------------------------------------------------
//   npm run staff                                list the staff
//   npm run staff -- manager <email> [campus]    add a manager of a campus (none: all campuses), or set an existing person to it
//   npm run staff -- remove <email>              remove a manager or a worker
// The ceos are not here: they are CEO_EMAILS in .env (request 56).
// On the server: bash /home/opc/aguda/app/deploy/server.sh staff manager <email> [campus]

if (import.meta.main) {
  const [command, email = "", campus] = process.argv.slice(2);
  const domains = (process.env.STAFF_DOMAINS ?? "mail.huji.ac.il,aguda.org.il").split(",").map((d) => d.trim().toLowerCase());
  let code = 0;
  if (command === "manager") {
    const checked = checkEmail(email, domains);
    if (!checked.ok) {
      console.error(`refused: ${checked.reason}. Use an address in ${domains.join(" or ")}`);
      code = 1;
    } else if (command === "manager" && campus !== undefined && !isCampus(campus)) {
      console.error(`refused: the campus must be one of: ${["גבעת רם", "הר הצופים", "עין כרם", "רחובות"].join(" | ")}`);
      code = 1;
    } else {
      const target = campus ?? null;
      await pool.query(
        `INSERT INTO staff (email, role, campus) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET role = excluded.role, campus = excluded.campus`,
        [checked.email, command, target],
      );
      console.log(`${checked.email} is a ${command} of ${target ?? "all campuses"}`);
    }
  } else if (command === "remove") {
    const r = await pool.query("DELETE FROM staff WHERE email = $1", [email.trim().toLowerCase()]);
    console.log(r.rowCount ? `${email} removed` : `${email} is not on the staff list`);
    code = r.rowCount ? 0 : 1;
  } else if (command === undefined) {
    for (const m of await listStaff()) console.log(`${m.role}\t${m.campus ?? "-"}\t${m.email}`);
  } else {
    console.error("usage: npm run staff -- [manager <email> [campus] | remove <email>]");
    code = 1;
  }
  await pool.end();
  process.exit(code);
}
