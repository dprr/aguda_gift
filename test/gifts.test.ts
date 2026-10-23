import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { pool } from "../src/db.ts";
import { counterDrift, markTaken, resetStudent, selectGift, unmarkTaken } from "../src/gifts.ts";
import { freshDatabase, gift, loadStudents, setMember, student } from "./helpers.ts";

beforeEach(() => freshDatabase());
after(() => pool.end());

// ---- §5.1 selection -------------------------------------------------------------------

test("a member selects a gift, and requested_count rises", async () => {
  const [id] = await loadStudents(1);
  assert.deepEqual(await selectGift(id, 2), { ok: true, giftId: 2 });
  assert.equal((await student(id)).gift_id, 2);
  assert.equal((await gift(2)).requested_count, 1);
});

test("a selection is final (request 3)", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 2);
  assert.deepEqual(await selectGift(id, 3), { ok: false, reason: "already_selected" });
  assert.equal((await student(id)).gift_id, 2);
  assert.equal((await gift(3)).requested_count, 0);
});

test("a repeated identical selection does not count twice", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 2);
  await selectGift(id, 2);
  assert.equal((await gift(2)).requested_count, 1);
});

test("a non-member cannot select, and an unknown member cannot either", async () => {
  const [member, nonMember, unknown] = await loadStudents(3, 1);
  await setMember(unknown, null);
  assert.equal((await selectGift(nonMember, 1)).ok, false);
  assert.deepEqual(await selectGift(nonMember, 1), { ok: false, reason: "not_member" });
  assert.deepEqual(await selectGift(unknown, 1), { ok: false, reason: "not_member" });
  assert.equal((await gift(1)).requested_count, 0);
  assert.equal((await selectGift(member, 1)).ok, true);
});

test("an unknown student and an unknown gift are refused", async () => {
  const [id] = await loadStudents(1);
  assert.deepEqual(await selectGift("999999999", 1), { ok: false, reason: "unknown_student" });
  assert.deepEqual(await selectGift(id, 99), { ok: false, reason: "unknown_gift" });
});

test("a sold-out gift cannot be selected, and the student keeps no selection (request 19)", async () => {
  await freshDatabase(2);
  const ids = await loadStudents(3);
  await selectGift(ids[0], 1);
  await selectGift(ids[1], 1);

  assert.deepEqual(await selectGift(ids[2], 1), { ok: false, reason: "sold_out" });
  assert.equal((await student(ids[2])).gift_id, null);
  assert.equal((await gift(1)).requested_count, 2);
  // The student can still pick another gift.
  assert.equal((await selectGift(ids[2], 2)).ok, true);
});

test("CONCURRENCY: 200 students race for 10 units; exactly 10 succeed", async () => {
  await freshDatabase(10);
  const ids = await loadStudents(200);

  const results = await Promise.all(ids.map((id) => selectGift(id, 1)));

  const won = results.filter((r) => r.ok).length;
  const soldOut = results.filter((r) => !r.ok && r.reason === "sold_out").length;
  assert.equal(won, 10);
  assert.equal(soldOut, 190);
  assert.equal((await gift(1)).requested_count, 10);
  const holders = await pool.query("SELECT count(*)::int AS n FROM students WHERE gift_id = 1");
  assert.equal(holders.rows[0].n, 10);
  assert.deepEqual(await counterDrift(), []);
});

test("CONCURRENCY: one student double-taps 20 times; one selection, one unit", async () => {
  const [id] = await loadStudents(1);
  const results = await Promise.all(Array.from({ length: 20 }, () => selectGift(id, 3)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await gift(3)).requested_count, 1);
  assert.deepEqual(await counterDrift(), []);
});

// ---- §5.2 handout ---------------------------------------------------------------------

test("marking as taken records the time, the interaction, and given_count", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 4);

  const result = await markTaken(id);

  assert.equal(result.ok, true);
  const s = await student(id);
  assert.ok(s.gift_taken_at);
  assert.equal(s.interactions.length, 1);
  assert.equal(s.interactions[0].type, "gift_collection");
  assert.equal(s.interactions[0].gift_id, 4);
  assert.equal((await gift(4)).given_count, 1);
});

test("a gift cannot be marked as taken twice (request 5)", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 4);
  const first = await markTaken(id);

  const second = await markTaken(id);

  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "already_taken");
  assert.deepEqual(
    !second.ok && second.reason === "already_taken" && second.takenAt,
    first.ok && first.takenAt,
  );
  assert.equal((await gift(4)).given_count, 1);
  assert.equal((await student(id)).interactions.length, 1);
});

test("a student with no selection is refused at the desk (request 6)", async () => {
  const [id] = await loadStudents(1);
  assert.deepEqual(await markTaken(id), { ok: false, reason: "no_selection" });
});

test("a lapsed member is refused at the desk, and the unit stays held (request 20)", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 1);
  await setMember(id, false);

  assert.deepEqual(await markTaken(id), { ok: false, reason: "not_member" });
  assert.equal((await student(id)).gift_id, 1);
  assert.equal((await gift(1)).requested_count, 1);
  assert.equal((await gift(1)).given_count, 0);

  // Renewing lets the student collect the held unit.
  await setMember(id, true);
  assert.equal((await markTaken(id)).ok, true);
  assert.equal((await gift(1)).given_count, 1);
});

test("CONCURRENCY: 8 desks mark the same student at once; exactly one wins (request 8)", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 2);

  const results = await Promise.all(Array.from({ length: 8 }, () => markTaken(id)));

  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok && r.reason === "already_taken").length, 7);
  assert.equal((await gift(2)).given_count, 1);
  assert.equal((await student(id)).interactions.length, 1);
  assert.deepEqual(await counterDrift(), []);
});

test("CONCURRENCY: selections and handouts mixed; the counters never drift", async () => {
  await freshDatabase(30);
  const ids = await loadStudents(120);

  await Promise.all(ids.map((id, i) => selectGift(id, (i % 4) + 1)));
  await Promise.all(ids.flatMap((id) => [markTaken(id), markTaken(id)]));

  assert.deepEqual(await counterDrift(), []);
  for (const g of [1, 2, 3, 4]) {
    const row = await gift(g);
    assert.equal(row.requested_count, 30);
    assert.equal(row.given_count, 30);
  }
});

// ---- request 30: staff let a student start again ---------------------------------------

test("deleting the selection returns the unit, and the student can select again", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 2);
  assert.deepEqual(await resetStudent(id, "gift"), { ok: true });
  assert.equal((await student(id)).gift_id, null);
  assert.ok((await student(id)).survey, "the survey stays");
  assert.equal((await gift(2)).requested_count, 0);
  assert.equal((await selectGift(id, 3)).ok, true);
  assert.deepEqual(await counterDrift(), []);
});

test("deleting all clears the survey too, so the student must answer it again", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 1);
  assert.deepEqual(await resetStudent(id, "all"), { ok: true });
  const s = await student(id);
  assert.equal(s.gift_id, null);
  assert.equal(s.survey, null);
  assert.deepEqual(await selectGift(id, 1), { ok: false, reason: "survey_missing" });
  assert.deepEqual(await counterDrift(), []);
});

test("a survey alone can be deleted; with nothing to delete, nothing changes", async () => {
  const [id, fresh] = await loadStudents(2);
  await pool.query("UPDATE students SET survey = NULL WHERE national_id = $1", [fresh]);
  assert.deepEqual(await resetStudent(id, "gift"), { ok: false, reason: "nothing" });
  assert.deepEqual(await resetStudent(id, "all"), { ok: true });
  assert.deepEqual(await resetStudent(fresh, "all"), { ok: false, reason: "nothing" });
  assert.deepEqual(await resetStudent("999", "all"), { ok: false, reason: "unknown_student" });
});

test("never after the handout: the student could collect a second gift", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 4);
  await markTaken(id);
  for (const what of ["gift", "all"] as const) {
    assert.deepEqual(await resetStudent(id, what), { ok: false, reason: "taken" });
  }
  const s = await student(id);
  assert.equal(s.gift_id, 4);
  assert.ok(s.survey);
  assert.equal((await gift(4)).requested_count, 1);
});

test("a deletion and a handout of one selection at the same moment: never both", async () => {
  for (let round = 0; round < 20; round++) {
    await freshDatabase();
    const [id] = await loadStudents(1);
    await selectGift(id, 1);
    const [reset, take] = await Promise.all([resetStudent(id, "gift"), markTaken(id)]);
    assert.ok(reset.ok !== take.ok, `round ${round}: exactly one wins`);
    assert.deepEqual(await counterDrift(), []);
  }
});

test("the database refuses a requested_count below zero", async () => {
  await assert.rejects(pool.query("UPDATE gifts SET requested_count = -1 WHERE id = 1"), /gifts_requested_not_negative/);
});

// ---- request 40: a ceo reverses a handout ----------------------------------------------

test("two reversals of one handout at the same moment count once", async () => {
  const [id] = await loadStudents(1);
  await selectGift(id, 1);
  await markTaken(id);
  const results = await Promise.all([unmarkTaken(id), unmarkTaken(id)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await gift(1)).given_count, 0);
  assert.deepEqual(await counterDrift(), []);
  assert.deepEqual(await unmarkTaken("999"), { ok: false, reason: "unknown_student" });
});

test("the database refuses a given_count below zero", async () => {
  await assert.rejects(pool.query("UPDATE gifts SET given_count = -1 WHERE id = 1"), /gifts_given_not_negative/);
});
