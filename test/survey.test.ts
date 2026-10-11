// Request 22: every student submits the survey before selecting a gift.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { selectGift } from "../src/gifts.ts";
import { buildApp } from "../src/server.ts";
import { submitSurvey, type Survey, validate } from "../src/survey.ts";
import { freshDatabase, gift, loadStudents, student } from "./helpers.ts";

after(() => pool.end());

const SURVEY: Survey = {
  version: 3,
  questions: [
    { id: "year", kind: "choice", label: "באיזו שנה אתה?", labelFemale: "באיזו שנה את?", required: true,
      options: [{ value: "1", label: "א" }, { value: "2", label: "ב" }, { value: "3", label: "ג+" }] },
    { id: "topics", kind: "multi", label: "מה מעניין אותך?", required: false,
      options: [{ value: "sport", label: "ספורט" }, { value: "culture", label: "תרבות" }] },
    { id: "note", kind: "text", label: "הערות", required: true },
  ],
};

const ORIGIN = "http://localhost:3000";
const noGoogle: GoogleLogin = {
  start: async () => { throw new Error("not used"); },
  finish: async () => { throw new Error("not used"); },
};
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let ids: string[];

const form = (body: string) => ({ payload: body, headers: { "content-type": "application/x-www-form-urlencoded" } });
async function asStudent(id: string) {
  const res = await app.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${id}`) });
  return { session: res.cookies.find((c) => c.name === "session")!.value };
}

beforeEach(async () => {
  await freshDatabase(5);
  ids = await loadStudents(4, 3, false); // 0-2 members, 3 not; nobody has answered
  app = await buildApp({
    google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
    devLogin: true, production: false, origin: ORIGIN, survey: SURVEY,
  });
});

describe("validate", () => {
  test("accepts a full answer, and drops fields that are not questions", () => {
    const r = validate(SURVEY, { year: "2", topics: ["sport", "culture"], note: " hi ", extra: "x" });
    assert.deepEqual(r, { ok: true, answers: { year: "2", topics: ["sport", "culture"], note: "hi" } });
  });
  test("reports each missing required answer", () => {
    assert.deepEqual(validate(SURVEY, { note: "  " }), { ok: false, errors: { year: "required", note: "required" } });
  });
  test("refuses a value that is not an option, or two values for one choice", () => {
    const r1 = validate(SURVEY, { year: "9", note: "x" });
    assert.deepEqual(!r1.ok && r1.errors, { year: "invalid" });
    const r2 = validate(SURVEY, { year: ["1", "2"], note: "x" });
    assert.deepEqual(!r2.ok && r2.errors, { year: "invalid" });
    const r3 = validate(SURVEY, { year: "1", topics: ["sport", "hacking"], note: "x" });
    assert.deepEqual(!r3.ok && r3.errors, { topics: "invalid" });
  });
  test("an optional multi-choice may be left empty", () => {
    assert.deepEqual(validate(SURVEY, { year: "1", note: "x" }), { ok: true, answers: { year: "1", note: "x" } });
  });
  test("an empty survey is valid with no answers", () => {
    assert.deepEqual(validate({ version: 1, questions: [] }, {}), { ok: true, answers: {} });
  });
});

describe("the survey comes before the gifts", () => {
  test("a member sees the survey, not the gifts", async () => {
    const page = (await app.inject({ url: "/student", cookies: await asStudent(ids[0]) })).body;
    assert.match(page, /action="\/student\/survey"/);
    assert.doesNotMatch(page, /\/student\/confirm\?gift=/);
  });

  test("a non-member sees the survey too", async () => {
    const page = (await app.inject({ url: "/student", cookies: await asStudent(ids[3]) })).body;
    assert.match(page, /action="\/student\/survey"/);
  });

  test("the confirm page and the selection are refused before the survey", async () => {
    const cookies = await asStudent(ids[0]);
    assert.equal((await app.inject({ url: "/student/confirm?gift=1", cookies })).headers.location, "/student");
    const post = await app.inject({ method: "POST", url: "/student/select", cookies, ...form("gift_id=1") });
    assert.equal(post.headers.location, "/student?error=survey_missing");
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "survey_missing" });
    assert.equal((await gift(1)).requested_count, 0);
  });

  test("an error comes back with every answer kept", async () => {
    const cookies = await asStudent(ids[0]);
    const res = await app.inject({ method: "POST", url: "/student/survey", cookies, ...form("topics=culture&note=") });
    assert.match(res.body, /יש לענות על השאלה/);
    assert.match(res.body, /value="culture" checked/);
    assert.equal((await student(ids[0])).survey, null);
  });

  test("a valid submission is stored with its version, then the gifts appear", async () => {
    const cookies = await asStudent(ids[0]);
    const res = await app.inject({ method: "POST", url: "/student/survey", cookies, ...form("year=2&topics=sport&topics=culture&note=%D7%AA%D7%95%D7%93%D7%94") });
    assert.equal(res.headers.location, "/student?surveyed=1");

    const stored = (await student(ids[0])).survey;
    assert.equal(stored.version, 3);
    assert.ok(stored.submitted_at);
    assert.deepEqual(stored.answers, { year: "2", topics: ["sport", "culture"], note: "תודה" });

    const page = (await app.inject({ url: "/student?surveyed=1", cookies })).body;
    assert.match(page, /התשובות נשמרו/);
    assert.match(page, /\/student\/confirm\?gift=/);
    assert.deepEqual(await selectGift(ids[0], 1), { ok: true, giftId: 1 });
  });

  test("submitted is final: a second submission changes nothing", async () => {
    const cookies = await asStudent(ids[0]);
    await app.inject({ method: "POST", url: "/student/survey", cookies, ...form("year=1&note=first") });
    await app.inject({ method: "POST", url: "/student/survey", cookies, ...form("year=3&note=second") });
    assert.deepEqual((await student(ids[0])).survey.answers, { year: "1", note: "first" });
  });

  test("CONCURRENCY: 10 simultaneous submissions; exactly one is stored", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => submitSurvey(ids[1], SURVEY, { year: "1", note: `try ${i}` })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === "already_submitted").length, 9);
  });

  test("labels and the button follow the student's gender", async () => {
    await pool.query("UPDATE students SET gender = 'נקבה' WHERE national_id = $1", [ids[0]]);
    await pool.query("UPDATE students SET gender = 'זכר' WHERE national_id = $1", [ids[1]]);
    const her = (await app.inject({ url: "/student", cookies: await asStudent(ids[0]) })).body;
    const him = (await app.inject({ url: "/student", cookies: await asStudent(ids[1]) })).body;
    assert.match(her, /באיזו שנה את\?/);
    assert.match(her, /<button class="button">שלחי<\/button>/);
    assert.match(him, /באיזו שנה אתה\?/);
    assert.match(him, /<button class="button">שלח<\/button>/);
  });

  test("a survey with no questions is just a submit button, and it works", async () => {
    const empty = await buildApp({
      google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
      devLogin: true, production: false, origin: ORIGIN, survey: { version: 1, questions: [] },
    });
    const res = await empty.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${ids[2]}`) });
    const cookies = { session: res.cookies.find((c) => c.name === "session")!.value };
    assert.match((await empty.inject({ url: "/student", cookies })).body, /action="\/student\/survey"/);
    const post = await empty.inject({ method: "POST", url: "/student/survey", cookies, ...form("") });
    assert.equal(post.headers.location, "/student?surveyed=1");
    assert.deepEqual((await student(ids[2])).survey.answers, {});
  });
});
