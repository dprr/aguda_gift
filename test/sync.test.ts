import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { pool } from "../src/db.ts";
import { FakeSource, fakeStudents } from "../src/source.ts";
import { SYNC_LOCK_KEY, syncStudents } from "../src/sync.ts";
import { freshDatabase, student } from "./helpers.ts";

beforeEach(() => freshDatabase());
after(() => pool.end());

const sync = (source: FakeSource, minStudents = 0) => syncStudents(source, { minStudents });

async function countStudents(): Promise<number> {
  return (await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n;
}

test("a first sync inserts every student", async () => {
  const result = await sync(new FakeSource(fakeStudents(100)));
  assert.deepEqual(result, {
    ok: true, received: 100, added: 100, profileChanged: 0, membershipChanged: 0,
  });
  assert.equal(await countStudents(), 100);
});

test("a repeated sync of identical data writes nothing", async () => {
  const source = new FakeSource(fakeStudents(100));
  await sync(source);
  const before = await pool.query("SELECT xmin, * FROM students ORDER BY national_id");

  const result = await sync(source);

  assert.deepEqual(result, {
    ok: true, received: 100, added: 0, profileChanged: 0, membershipChanged: 0,
  });
  // xmin changes whenever PostgreSQL writes a row. Identical xmin proves no row was touched.
  const afterRows = await pool.query("SELECT xmin, * FROM students ORDER BY national_id");
  assert.deepEqual(afterRows.rows, before.rows);
});

test("first sight stores the membership the source reports, never an assumed true", async () => {
  const students = fakeStudents(3).map((s, i) => ({ ...s, member: [true, false, null][i] }));
  await sync(new FakeSource(students));

  for (const [i, expected] of [true, false, null].entries()) {
    const s = await student(students[i].national_id);
    assert.equal(s.member, expected);
    assert.equal(s.membership_history.length, 1);
    assert.equal(s.membership_history[0].member, expected);
  }
});

test("membership changes append to the history, and rejoining is preserved", async () => {
  const students = fakeStudents(1).map((s) => ({ ...s, member: true }));
  const source = new FakeSource(students);
  await sync(source);

  source.students[0].member = false;
  const left = await sync(source);
  source.students[0].member = true;
  const rejoined = await sync(source);

  assert.equal(left.ok && left.membershipChanged, 1);
  assert.equal(rejoined.ok && rejoined.membershipChanged, 1);
  const s = await student(students[0].national_id);
  assert.deepEqual(s.membership_history.map((e: { member: boolean }) => e.member), [true, false, true]);
  assert.equal(s.member, true);
});

test("a profile change updates the column and adds no membership history", async () => {
  const source = new FakeSource(fakeStudents(1));
  await sync(source);
  source.students[0].faculty = "משפטים";

  const result = await sync(source);

  assert.equal(result.ok && result.profileChanged, 1);
  assert.equal(result.ok && result.membershipChanged, 0);
  const s = await student(source.students[0].national_id);
  assert.equal(s.faculty, "משפטים");
  assert.equal(s.membership_history.length, 1);
});

test("a student absent from the response is left untouched and never deleted", async () => {
  const source = new FakeSource(fakeStudents(10));
  await sync(source);
  const gone = source.students[9].national_id;
  const before = await pool.query("SELECT xmin, * FROM students WHERE national_id = $1", [gone]);

  source.students = source.students.slice(0, 9);
  await sync(source);

  assert.equal(await countStudents(), 10);
  const afterRow = await pool.query("SELECT xmin, * FROM students WHERE national_id = $1", [gone]);
  assert.deepEqual(afterRow.rows, before.rows);
});

test("university email is stored lowercase", async () => {
  const students = fakeStudents(1).map((s) => ({ ...s, university_email: "Dana.Cohen@Mail.HUJI.ac.il" }));
  await sync(new FakeSource(students));
  assert.equal((await student(students[0].national_id)).university_email, "dana.cohen@mail.huji.ac.il");
});

test("a response below the minimum is refused and writes nothing", async () => {
  await sync(new FakeSource(fakeStudents(100)));
  const source = new FakeSource(fakeStudents(50).map((s) => ({ ...s, member: false })));

  const result = await sync(source, 80);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "too_few");
  const changed = await pool.query("SELECT count(*)::int AS n FROM students WHERE jsonb_array_length(membership_history) > 1");
  assert.equal(changed.rows[0].n, 0);
});

test("an empty response is refused", async () => {
  const result = await sync(new FakeSource([]), 1);
  assert.equal(!result.ok && result.reason, "too_few");
});

test("a duplicate national ID refuses the whole response", async () => {
  const students = fakeStudents(5);
  students[4] = { ...students[4], national_id: students[0].national_id };
  const result = await sync(new FakeSource(students));
  assert.equal(!result.ok && result.reason, "invalid");
  assert.equal(await countStudents(), 0);
});

test("a database failure after some writes rolls all of them back", async () => {
  const all = fakeStudents(20);
  await sync(new FakeSource(all.slice(0, 10)));

  // Students 1-9 return, student 10 is absent, and students 11-20 are new. Student 1 takes
  // student 10's email. The response itself has no duplicate, so validation passes. The
  // INSERT of students 11-20 succeeds first, then the profile UPDATE hits the unique email
  // of the absent student 10 and fails. Without one transaction, 11-20 would stay.
  const response = [...all.slice(0, 9), ...all.slice(10)];
  response[0] = { ...response[0], university_email: all[9].university_email };

  await assert.rejects(sync(new FakeSource(response)), /unique/);

  assert.equal(await countStudents(), 10);
  assert.equal((await student(all[0].national_id)).university_email, all[0].university_email);
});

test("a second sync is refused while one is running", async () => {
  const holder = await pool.connect();
  await holder.query("SELECT pg_advisory_lock($1)", [SYNC_LOCK_KEY]);
  try {
    const result = await sync(new FakeSource(fakeStudents(5)));
    assert.equal(!result.ok && result.reason, "busy");
    assert.equal(await countStudents(), 0);
  } finally {
    await holder.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_KEY]);
    holder.release();
  }
});

test("23,000 students: first sync, then an identical repeat", async () => {
  const source = new FakeSource(fakeStudents(23_000));

  let start = performance.now();
  const first = await sync(source, 20_000);
  const firstMs = performance.now() - start;

  start = performance.now();
  const repeat = await sync(source, 20_000);
  const repeatMs = performance.now() - start;

  console.log(`  23,000 students: first sync ${Math.round(firstMs)} ms, repeat ${Math.round(repeatMs)} ms`);
  assert.equal(first.ok && first.added, 23_000);
  assert.equal(repeat.ok && repeat.added + repeat.profileChanged + repeat.membershipChanged, 0);
  assert.ok(firstMs < 30_000, "first sync must finish within 30 seconds");
});
