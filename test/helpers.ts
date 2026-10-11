import { pool } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { seedGifts } from "../src/seed.ts";
import { fakeStudents, FakeSource } from "../src/source.ts";
import { syncStudents } from "../src/sync.ts";

if (!process.env.DATABASE_URL?.endsWith("/aguda_test")) {
  throw new Error("tests must run against aguda_test. Use `npm test`.");
}

/** Drop everything and start from the migrations, with small stock so tests reach zero. */
export async function freshDatabase(stock = 10): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS students, gifts, workers CASCADE");
  await migrate();
  await seedGifts(pool, [
    { id: 1, name: "קפוצ'ון", description: "", starting_inventory: stock },
    { id: 2, name: "ספל", description: "", starting_inventory: stock },
    { id: 3, name: "תיק בד", description: "", starting_inventory: stock },
    { id: 4, name: "בקבוק מים", description: "", starting_inventory: stock },
  ]);
}

/**
 * Load `count` fake students, and make the first `members` of them members. By default
 * they have already submitted the survey (request 22), so gift tests start at the gifts.
 */
export async function loadStudents(count: number, members = count, surveyDone = true): Promise<string[]> {
  const students = fakeStudents(count).map((s, i) => ({ ...s, member: i < members }));
  const result = await syncStudents(new FakeSource(students), { minStudents: 0 });
  if (!result.ok) throw new Error(`load failed: ${result.detail}`);
  if (surveyDone) {
    await pool.query(
      `UPDATE students SET survey = '{"version": 0, "submitted_at": "2026-01-01T00:00:00Z", "answers": {}}'`,
    );
  }
  return students.map((s) => s.national_id);
}

export async function student(nationalId: string) {
  const r = await pool.query("SELECT * FROM students WHERE national_id = $1", [nationalId]);
  return r.rows[0];
}

export async function gift(id: number) {
  const r = await pool.query("SELECT * FROM gifts WHERE id = $1", [id]);
  return r.rows[0];
}

export async function setMember(nationalId: string, member: boolean | null) {
  await pool.query("UPDATE students SET member = $2 WHERE national_id = $1", [nationalId, member]);
}
