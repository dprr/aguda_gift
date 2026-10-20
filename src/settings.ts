/** Request 33. Site settings that a ceo changes on the manager page. One row. */
import { pool } from "./db.ts";

/** Whether students see the survey's extra questions. On if the row is somehow missing. */
export async function extraQuestionsEnabled(): Promise<boolean> {
  const r = await pool.query("SELECT extra_questions FROM settings");
  return r.rows[0]?.extra_questions ?? true;
}

export async function setExtraQuestions(enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO settings (extra_questions) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET extra_questions = excluded.extra_questions`,
    [enabled],
  );
}

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
