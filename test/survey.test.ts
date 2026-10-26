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
    assert.match(res.body, /(ענה|עני) על השאלה/);
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
    assert.match(page, /שמרנו את התשובות/);
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

describe("the live survey", () => {
  test("is well-formed", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const ids = LIVE.questions.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, "question ids are unique");
    for (const q of LIVE.questions) {
      assert.match(q.id, /^[a-z][a-z0-9_]*$/, `id ${q.id}`);
      assert.ok(q.label.trim(), `label of ${q.id}`);
      if (q.kind !== "text") {
        const values = q.options.map((o) => o.value);
        assert.ok(values.length > 0, `${q.id} has options`);
        assert.equal(new Set(values).size, values.length, `${q.id} option values are unique`);
        for (const o of q.options) assert.ok(o.label.trim(), `option label in ${q.id}`);
      }
    }
  });

  test('"אחר" requires its text, and the text is stored beside the choice', async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const base = { father: "no", welfare: "yes", dorms: "no", reserve: "no", special: "no", social: "yes", elections: "pirates" };
    const missing = validate(LIVE, { extra_open: "1", ...base, fences: "other", fences_text: "  " });
    assert.deepEqual(!missing.ok && missing.errors, { fences: "required" });

    const given = validate(LIVE, { extra_open: "1", ...base, fences: "other", fences_text: " דעה אחרת " });
    assert.deepEqual(given, { ok: true, answers: { fences: ["other"], fences_text: "דעה אחרת", ...base } });

    // The text of an option that was not chosen is dropped.
    const ignored = validate(LIVE, { extra_open: "1", ...base, fences: "disaster", fences_text: "leftover" });
    assert.deepEqual(ignored, { ok: true, answers: { fences: ["disaster"], ...base } });
  });

  test("fences takes several answers, is optional, and \"אחר\" still needs its text", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const base = { father: "no", welfare: "yes", dorms: "no", reserve: "no", special: "no", social: "yes", elections: "pirates" };
    const two = validate(LIVE, { extra_open: "1", ...base, fences: ["disaster", "technion"] });
    assert.ok(two.ok && JSON.stringify(two.answers.fences) === '["disaster","technion"]');
    const none = validate(LIVE, { ...base });
    assert.ok(none.ok && !("fences" in none.answers), "an extra question may stay empty");
    const otherEmpty = validate(LIVE, { extra_open: "1", ...base, fences: ["disaster", "other"], fences_text: "" });
    assert.deepEqual(!otherEmpty.ok && otherEmpty.errors, { fences: "required" });
    const otherGiven = validate(LIVE, { extra_open: "1", ...base, fences: ["disaster", "other"], fences_text: "גדר" });
    assert.ok(otherGiven.ok && otherGiven.answers.fences_text === "גדר");
  });

  test("the elections question is an optional dropdown with the two owner's options", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const base = { fences: "disaster", father: "no", welfare: "yes", dorms: "no", reserve: "no", special: "no", social: "yes" };
    const empty = validate(LIVE, { extra_open: "1", ...base, elections: "" });
    assert.ok(empty.ok && !("elections" in empty.answers));
    const fake = validate(LIVE, { extra_open: "1", ...base, elections: "likud" });
    assert.deepEqual(!fake.ok && fake.errors, { elections: "invalid" });
    const ok = validate(LIVE, { extra_open: "1", ...base, elections: "throw_away" });
    assert.ok(ok.ok && ok.answers.elections === "throw_away");
  });

  test("an option's wording follows the student's gender", async () => {
    const live = await buildApp({
      google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
      devLogin: true, production: false, origin: ORIGIN,
    });
    await pool.query("UPDATE students SET gender = 'נקבה' WHERE national_id = $1", [ids[0]]);
    await pool.query("UPDATE students SET gender = NULL WHERE national_id = $1", [ids[1]]);
    const page = async (id: string) => {
      const r = await live.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${id}`) });
      return (await live.inject({ url: "/student", cookies: { session: r.cookies.find((c) => c.name === "session")!.value } })).body;
    };
    const her = await page(ids[0]);
    const him = await page(ids[1]);
    assert.match(her, /שוקלת לעבור לטכניון/);
    assert.match(her, /מה את חושבת על/);
    assert.match(her, /האם את צופה ליהנות/);
    assert.match(him, /שוקל לעבור לטכניון/, "unknown gender is masculine");
    assert.match(him, /מה אתה חושב על/);
    assert.match(him, /האם אתה צופה ליהנות/);
    assert.match(her, /<input type="checkbox" name="fences" value="disaster">/, "fences takes several answers");
    assert.match(her, /למי תצביעי בבחירות הקרובות\?/);
    assert.match(him, /למי תצביע בבחירות הקרובות\?/);
    assert.match(her, /<select name="elections"><option value="">בחרי<\/option><option value="pirates">הפיראטים<\/option>/);
    // The owner's rules: never the plural אתם, and the spelling ליהנות.
    for (const html of [her, him]) {
      assert.doesNotMatch(html, /אתם/);
      assert.doesNotMatch(html, /להנות/);
    }
  });
});

describe("extra questions", () => {
  const EXTRA = ["fences", "father", "welfare", "elections"];

  test("the four are optional and marked extra; every other question keeps its rule", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    for (const q of LIVE.questions) {
      assert.equal(Boolean(q.extra), EXTRA.includes(q.id), q.id);
      if (q.extra) assert.equal(q.required, false, q.id);
    }
    const onlyRequired = validate(LIVE, { dorms: "no", reserve: "no", special: "no", social: "no" });
    assert.ok(onlyRequired.ok, "the survey submits with every extra question empty");
  });

  const page = async (id: string, body?: string) => {
    const live = await buildApp({
      google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
      devLogin: true, production: false, origin: ORIGIN,
    });
    const r = await live.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${id}`) });
    const cookies = { session: r.cookies.find((c) => c.name === "session")!.value };
    return body === undefined
      ? (await live.inject({ url: "/student", cookies })).body
      : (await live.inject({ method: "POST", url: "/student/survey", cookies, ...form(body) })).body;
  };

  test("they come last, inside the hidden section, after an unchecked checkbox", async () => {
    const html = await page(ids[0]);
    const toggle = html.indexOf('class="option extra-toggle"><input type="checkbox" name="extra_open" value="1" onchange=');
    assert.ok(toggle > 0, "the checkbox starts unchecked, and clears the answers when unchecked");
    assert.ok(html.indexOf('name="more"') < toggle, "after every other question");
    const section = html.slice(html.indexOf('<div class="extra">'));
    for (const id of EXTRA) assert.ok(section.includes(`name="${id}"`), id);
    assert.match(html, /form:has\(\.extra-toggle input:checked\) \.extra \{ display: block; \}/);
    assert.doesNotMatch(section.slice(0, section.indexOf("</div>\n<button")), /\(חובה\)/, "no extra question is marked required");
  });

  test("with the box unchecked, extra answers the browser still sends are not stored", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const required = { dorms: "no", reserve: "no", special: "no", social: "no" };
    const sent = { ...required, fences: ["other"], fences_text: "", father: "no", welfare: "yes", elections: "pirates" };
    const closed = validate(LIVE, sent);
    assert.ok(closed.ok, "an invalid hidden answer is no error either");
    assert.deepEqual(Object.keys(closed.answers).sort(), Object.keys(required).sort());
    const open = validate(LIVE, { ...sent, extra_open: "1", fences_text: "גדר" });
    assert.ok(open.ok && open.answers.father === "no" && open.answers.elections === "pirates");

    await page(ids[0], new URLSearchParams({ ...required, father: "no", elections: "pirates" }).toString());
    const stored = (await pool.query("SELECT survey FROM students WHERE national_id = $1", [ids[0]])).rows[0].survey;
    assert.equal(stored.version, 1);
    assert.ok(!("father" in stored.answers) && !("elections" in stored.answers));
  });

  test("an error in an extra question opens the section, so the student sees it", async () => {
    const html = await page(ids[0], "dorms=no&reserve=no&special=no&social=no&extra_open=1&fences=other&fences_text=");
    assert.match(html, /class="option extra-toggle"><input type="checkbox" name="extra_open" value="1" checked/);
    assert.match(html, /class="error"/);
  });
});

describe("dorms, special population, social, and more", () => {
  const base = { fences: "disaster", father: "no", welfare: "no", reserve: "yes", special: "no", social: "no", elections: "pirates" };

  test("a dorm is required after כן, must be a real dorm, and is dropped after לא", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const missing = validate(LIVE, { ...base, dorms: "yes", dorms_choice: "" });
    assert.deepEqual(!missing.ok && missing.errors, { dorms: "required" });
    const fake = validate(LIVE, { ...base, dorms: "yes", dorms_choice: "hilton" });
    assert.deepEqual(!fake.ok && fake.errors, { dorms: "invalid" });
    const real = validate(LIVE, { ...base, dorms: "yes", dorms_choice: "reznik" });
    assert.ok(real.ok && real.answers.dorms_choice === "reznik");
    const no = validate(LIVE, { ...base, dorms: "no", dorms_choice: "reznik" });
    assert.ok(no.ok && !("dorms_choice" in no.answers));
  });

  test("special population: כן needs at least one category, any number, each a real one", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const none = validate(LIVE, { ...base, dorms: "no", special: "yes" });
    assert.deepEqual(!none.ok && none.errors, { special: "required" });
    const fake = validate(LIVE, { ...base, dorms: "no", special: "yes", special_choices: ["druze", "martian"] });
    assert.deepEqual(!fake.ok && fake.errors, { special: "invalid" });
    const one = validate(LIVE, { ...base, dorms: "no", special: "yes", special_choices: "druze" });
    assert.ok(one.ok && JSON.stringify(one.answers.special_choices) === '["druze"]');
    const many = validate(LIVE, { ...base, dorms: "no", special: "yes", special_choices: ["arab_israeli", "former_haredi", "other"] });
    assert.ok(many.ok && (many.answers.special_choices as string[]).length === 3);
    const no = validate(LIVE, { ...base, dorms: "no", special: "no", special_choices: ["druze"] });
    assert.ok(no.ok && !("special_choices" in no.answers), "categories are dropped after לא");
  });

  test("special population renders as a dropdown, and כן reveals gendered checkboxes", async () => {
    const live = await buildApp({
      google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
      devLogin: true, production: false, origin: ORIGIN,
    });
    await pool.query("UPDATE students SET gender = 'Female' WHERE national_id = $1", [ids[0]]);
    const r = await live.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${ids[0]}`) });
    const html = (await live.inject({ url: "/student", cookies: { session: r.cookies.find((c) => c.name === "session")!.value } })).body;
    assert.match(html, /<select name="special"><option value="">בחרי<\/option><option value="yes">כן<\/option><option value="no">לא<\/option><\/select>/);
    assert.match(html, /<div class="when" data-when="yes"><div class="choices">/);
    assert.match(html, /option\[value="yes"\]:checked\) \.when\[data-when="yes"\] \{ display: block; \}/);
    assert.equal(html.split('type="checkbox" name="special_choices"').length - 1, 12);
    assert.match(html, /value="arab_israeli"> ערבייה בעלת אזרחות ישראלית/);
    assert.match(html, /value="left_religion"> יוצאת בשאלה שאינה חרדית/);
  });

  test("the last question is optional", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    assert.ok(validate(LIVE, { ...base, dorms: "no" }).ok);
  });

  test("the dorm list is exactly the owner's list of 2026-10-23, each value once", async () => {
    const { SURVEY: LIVE } = await import("../src/survey.ts");
    const q = LIVE.questions.find((x) => x.id === "dorms")!;
    assert.ok(q.kind === "choice");
    const follow = q.options.find((o) => o.value === "yes")!.follow!;
    assert.ok(follow.kind === "select");
    const values = follow.groups.flatMap((g) => g.options.map((o) => o.value));
    assert.equal(new Set(values).size, values.length);
    const byCampus = Object.fromEntries(follow.groups.map((g) => [g.label, g.options.map((o) => o.label)]));
    assert.deepEqual(byCampus, {
      "הר הצופים": ["כפר הסטודנטים", "רזניק"],
      "גבעת רם": ["ברנדמן", "צוויג", "ליברמן"],
      "עין כרם": ["בוסטון", "גואטמלה", "שטרן"],
      "רחובות": ["מעונות הפקולטה", "שיכון ובינוי (לא תחת האוניברסיטה)"],
    });
  });

  test("the dropdown, the general links, and each campus's own links render", async () => {
    const live = await buildApp({
      google: noGoogle, sessionSecret: "s".repeat(32), domains: { student: ["mail.huji.ac.il"], staff: ["aguda.org.il"] },
      devLogin: true, production: false, origin: ORIGIN,
    });
    const set = (id: string, campuses: string[], gender: string | null) =>
      pool.query("UPDATE students SET campuses = $2, gender = $3 WHERE national_id = $1", [id, campuses, gender]);
    await set(ids[0], ["הר הצופים"], "נקבה");
    await set(ids[1], ["רחובות"], "זכר");
    await set(ids[3], ["גבעת רם", "רחובות"], "זכר");
    await set(ids[2], [], "זכר");
    const page = async (id: string) => {
      const r = await live.inject({ method: "POST", url: "/auth/dev", ...form(`kind=student&national_id=${id}`) });
      return (await live.inject({ url: "/student", cookies: { session: r.cookies.find((c) => c.name === "session")!.value } })).body;
    };
    const scopus = await page(ids[0]);
    const rehovot = await page(ids[1]);
    const unknown = await page(ids[2]);

    assert.match(scopus, /<select class="follow" name="dorms_choice">/);
    for (const html of [scopus, rehovot, unknown]) {
      assert.match(html, /instagram.com\/huji_aguda/, "general Instagram for everyone");
      assert.match(html, /chat.whatsapp.com\/LDsyY8tCWl606fSQbVK0tJ/, "general WhatsApp for everyone");
    }
    assert.match(scopus, /instagram.com\/aguda.har/);
    assert.doesNotMatch(scopus, /אין קבוצת וואטסאפ/, "no note for a campus without WhatsApp");
    assert.match(rehovot, /instagram.com\/hafakulta/);
    assert.match(rehovot, /phone=972559500921/);
    // Several campuses: only the true campus, the first one (request 43). Exactly 2 lines.
    const twoCampuses = await page(ids[3]);
    assert.doesNotMatch(twoCampuses, /instagram.com\/hafakulta/, "not the second campus");
    assert.match(twoCampuses, />האינסטגרם של האגודה בקמפוס גבעת רם</);
    for (const html of [scopus, rehovot, twoCampuses]) {
      const fieldset = html.slice(html.indexOf('name="social"') - 2000, html.indexOf('name="social"'));
      assert.equal(fieldset.split('<p class="hint">').length - 1, 2, "exactly two link lines");
    }
    assert.doesNotMatch(unknown, /בקמפוס/, "no campus line when the campus is unknown");
    assert.match(scopus, /target="_blank" rel="noopener noreferrer"/);
  });
});
