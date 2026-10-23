import { pool } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { CAMPUSES } from "../src/campus.ts";
import { seedGifts } from "../src/seed.ts";
import { fakeStudents, FakeSource } from "../src/source.ts";
import { syncStudents } from "../src/sync.ts";

if (!process.env.DATABASE_URL?.endsWith("/aguda_test")) {
  throw new Error("tests must run against aguda_test. Use `npm test`.");
}

/** Request 41: every test student belongs to this campus, and so do the test staff. */
export const TEST_CAMPUS = "הר הצופים";

/** Drop everything and start from the migrations, with small stock so tests reach zero. */
export async function freshDatabase(stock = 10): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS students, gifts, gift_stock, staff, workers, settings CASCADE");
  await migrate();
  const perCampus = { 1: stock, 2: stock, 3: stock, 4: stock };
  await seedGifts(
    pool,
    [
      { id: 1, name: "קפוצ'ון", description: "" },
      { id: 2, name: "ספל", description: "" },
      { id: 3, name: "תיק בד", description: "" },
      { id: 4, name: "בקבוק מים", description: "" },
    ],
    Object.fromEntries(CAMPUSES.map((c) => [c, perCampus])),
  );
}

/**
 * Load `count` fake students, and make the first `members` of them members. By default
 * they have already submitted the survey (request 22), so gift tests start at the gifts.
 */
export async function loadStudents(count: number, members = count, surveyDone = true): Promise<string[]> {
  // Request 27: everyone on the list is a member, so the rest are set apart afterwards.
  const students = fakeStudents(count).map((s) => ({ ...s, campuses: [TEST_CAMPUS] }));
  const result = await syncStudents(new FakeSource(students), { minStudents: 0 });
  if (!result.ok) throw new Error(`load failed: ${result.detail}`);
  await pool.query("UPDATE students SET member = false WHERE national_id = ANY($1)", [
    students.slice(members).map((s) => s.national_id),
  ]);
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

/** A gift with its stock on `campus` (request 41). */
export async function gift(id: number, campus = TEST_CAMPUS) {
  const r = await pool.query(
    "SELECT g.*, k.campus, k.starting_inventory, k.requested_count, k.given_count FROM gifts g JOIN gift_stock k ON k.gift_id = g.id WHERE g.id = $1 AND k.campus = $2",
    [id, campus],
  );
  return r.rows[0];
}

export async function setMember(nationalId: string, member: boolean | null) {
  await pool.query("UPDATE students SET member = $2 WHERE national_id = $1", [nationalId, member]);
}
