/** Site settings, in one row. Request 35: the staff alerts. */
import { pool } from "./db.ts";

/** Request 35. A staff member removed after 5 wrong IDs in a row. */
export type StaffAlert = { at: string; email: string; role: string };

export async function staffAlerts(): Promise<StaffAlert[]> {
  const r = await pool.query("SELECT staff_alerts FROM settings");
  return r.rows[0]?.staff_alerts ?? [];
}

/**
 * Clears the alerts up to `upTo`, the newest one the ceo saw. An alert added after the page
 * loaded stays, so nothing is cleared unseen.
 */
export async function clearStaffAlerts(upTo: string): Promise<void> {
  await pool.query(
    `UPDATE settings
        SET staff_alerts = COALESCE(
          (SELECT jsonb_agg(a) FROM jsonb_array_elements(staff_alerts) a
            WHERE (a->>'at')::timestamptz > $1::timestamptz),
          '[]')`,
    [upTo],
  );
}
