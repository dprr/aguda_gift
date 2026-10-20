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
