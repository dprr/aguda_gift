// Request 41: a gift stock per campus, staff per campus, and each student's true campus.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { counterDrift, markTaken, selectGift } from "../src/gifts.ts";
import { GIFTS, STOCK } from "../src/seed.ts";
import { buildApp } from "../src/server.ts";
import { freshDatabase, gift, loadStudents, student, TEST_CAMPUS } from "./helpers.ts";

after(() => pool.end());

const ORIGIN = "http://localhost:3000";
const noGoogle: GoogleLogin = {
  start: async () => { throw new Error("not used"); },
  finish: async () => { throw new Error("not used"); },
};
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let ids: string[];

const form = (body: Record<string, string>) => ({
  payload: new URLSearchParams(body).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});
async function login(body: Record<string, string>) {
  const res = await app.inject({ method: "POST", url: "/auth/dev", ...form(body) });
  const session = res.cookies.find((c) => c.name === "session")?.value;
  assert.ok(session, `login failed: ${res.headers.location}`);
  return { session };
}
const asStaff = (email: string) => login({ kind: "staff", email });
const setCampuses = (id: string, campuses: string[]) =>
  pool.query("UPDATE students SET campuses = $2 WHERE national_id = $1", [id, campuses]);
/** Request 68: a רחובות student must pick רחובות or מכון וולקני; this one picked רחובות. */
const setRehovot = (id: string) =>
  pool.query("UPDATE students SET campuses = '{רחובות}', chosen_campus = 'רחובות' WHERE national_id = $1", [id]);
const lookup = (cookies: { session: string }, national_id: string) =>
  app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id }) });

beforeEach(async () => {
  await freshDatabase(5);
  ids = await loadStudents(6); // all members, all of TEST_CAMPUS (הר הצופים)
  await pool.query(`INSERT INTO staff (email, role, campus) VALUES
    ('har@aguda.org.il', 'worker', 'הר הצופים'),
    ('givat@aguda.org.il', 'worker', 'גבעת רם'),
    ('harboss@aguda.org.il', 'manager', 'הר הצופים'),
    ('allcampus@aguda.org.il', 'worker', NULL),
    ('allboss@aguda.org.il', 'manager', NULL)`);
  app = await buildApp({
    google: noGoogle,
    sessionSecret: "test-secret-test-secret-test-secret",
    domains: { student: ["mail.huji.ac.il"], staff: ["mail.huji.ac.il", "aguda.org.il"] },
    devLogin: true,
    production: false,
    origin: ORIGIN,
    ceos: ["chief@aguda.org.il"],
  });
});

describe("the true campus and the stock of each campus", () => {
  test("the true campus is the first campus in the list, and null without one", async () => {
    await setCampuses(ids[0], ["גבעת רם", "הר הצופים"]);
    await setCampuses(ids[1], []);
    assert.equal((await student(ids[0])).true_campus, "גבעת רם");
    assert.equal((await student(ids[1])).true_campus, null);
    assert.equal((await student(ids[2])).true_campus, TEST_CAMPUS);
  });

  test("a selection takes a unit from the student's own campus", async () => {
    await setRehovot(ids[0]);
    assert.equal((await selectGift(ids[0], 2)).ok, true);
    assert.equal((await gift(2, "רחובות")).requested_count, 1);
    assert.equal((await gift(2, TEST_CAMPUS)).requested_count, 0);
  });

  test("a gift sold out on the student's campus is sold out for them, even with stock elsewhere", async () => {
    await setRehovot(ids[0]);
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 1 AND campus = 'רחובות'");
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "sold_out" });
    assert.equal((await selectGift(ids[1], 1)).ok, true, "a student of another campus still selects it");
  });

  test("the student page shows the student's own campus stock", async () => {
    await setRehovot(ids[0]);
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 3 AND campus = 'רחובות'");
    const cookies = await login({ kind: "student", national_id: ids[0] });
    const page = (await app.inject({ url: "/student", cookies })).body;
    assert.doesNotMatch(page, /confirm\?gift=3"/, "sold out on רחובות");
    const other = (await app.inject({ url: "/student", cookies: await login({ kind: "student", national_id: ids[1] }) })).body;
    assert.match(other, /confirm\?gift=3"/, "still available on הר הצופים");
  });

  test("a member with no campus cannot select, and is told why", async () => {
    await setCampuses(ids[0], []);
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "no_campus" });
    const page = (await app.inject({ url: "/student", cookies: await login({ kind: "student", national_id: ids[0] }) })).body;
    assert.match(page, /לא מצאנו את הקמפוס שלך/);
    assert.doesNotMatch(page, /confirm\?gift=/);
  });

  test("a handout counts on the student's campus", async () => {
    await setRehovot(ids[0]);
    await selectGift(ids[0], 4);
    assert.equal((await markTaken(ids[0])).ok, true);
    assert.equal((await gift(4, "רחובות")).given_count, 1);
    assert.equal((await gift(4, TEST_CAMPUS)).given_count, 0);
    assert.deepEqual(await counterDrift(), []);
  });

  test("the seed holds the owner's stock on the 4 campuses, and 0 on the 4 sub-campuses", () => {
    assert.deepEqual(Object.keys(STOCK).sort(), ["אסף הרופא", "גבעת רם", "הר הצופים", "מכון וולקני", "עין כרם", "קפלן", "רחובות", "ריפוי בעיסוק"]);
    for (const byGift of Object.values(STOCK)) assert.deepEqual(Object.keys(byGift).map(Number), GIFTS.map((g) => g.id));
    assert.equal(STOCK["הר הצופים"][2], 958);
    assert.equal(STOCK["רחובות"][1], 190);
    assert.equal(STOCK["קפלן"][1], 0);
  });
});

describe("sub-campuses (request 55)", () => {
  const setSub = (id: string, campus: string, sub: string | null) =>
    pool.query("UPDATE students SET campuses = $2, sub_campus = $3 WHERE national_id = $1", [id, [campus], sub]);

  test("a sub-campus student selects from the sub-campus stock, and keeps the campus logo", async () => {
    await setSub(ids[0], "עין כרם", "קפלן");
    const s = await student(ids[0]);
    assert.equal(s.true_campus, "עין כרם");
    assert.equal(s.stock_campus, "קפלן");
    assert.equal((await selectGift(ids[0], 2)).ok, true);
    assert.equal((await gift(2, "קפלן")).requested_count, 1);
    assert.equal((await gift(2, "עין כרם")).requested_count, 0);
    const page = (await app.inject({ url: "/student", cookies: await login({ kind: "student", national_id: ids[0] }) })).body;
    assert.match(page, /src="\/img\/ein_karem.jpg"/);
    const confirm = (await app.inject({ url: "/student/received", cookies: await login({ kind: "student", national_id: ids[0] }) })).body;
    assert.match(confirm, /<img src="\/img\/ein_karem.jpg" alt="">עין כרם · קפלן<\/span>/, "the sub-campus stock too (request 64)");
    assert.equal((await markTaken(ids[0])).ok, true);
    assert.equal((await gift(2, "קפלן")).given_count, 1);
    assert.deepEqual(await counterDrift(), []);
  });

  test("a sold-out sub-campus is sold out even with עין כרם stock", async () => {
    await setSub(ids[0], "עין כרם", "אסף הרופא");
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 1 AND campus = 'אסף הרופא'");
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "sold_out" });
  });

  test("עין כרם staff serve sub-campus students and see the 4 stock points", async () => {
    await setSub(ids[0], "עין כרם", "קפלן");
    await pool.query("INSERT INTO staff (email, role, campus) VALUES ('ek@aguda.org.il', 'worker', 'עין כרם'), ('ekboss@aguda.org.il', 'manager', 'עין כרם')");
    const worker = await asStaff("ek@aguda.org.il");
    assert.match((await lookup(worker, ids[0])).body, /<dt>/, "the student card");
    const desk = (await app.inject({ url: "/staff", cookies: worker })).body;
    assert.match(desk, /<th>קמפוס<\/th>/);
    for (const p of ["עין כרם", "אסף הרופא", "קפלן", "ריפוי בעיסוק"]) assert.match(desk, new RegExp(`<tr><td>${p}</td>`), p);
    assert.doesNotMatch(desk, /<tr><td>גבעת רם<\/td>/);
    // The עין כרם manager sets a sub-campus's stock; another campus's manager cannot.
    await app.inject({ method: "POST", url: "/manager/stock", cookies: await asStaff("ekboss@aguda.org.il"), ...form({ gift_id: "3", campus: "קפלן", starting_inventory: "30" }) });
    assert.equal((await gift(3, "קפלן")).starting_inventory, 30);
    await app.inject({ method: "POST", url: "/manager/stock", cookies: await asStaff("harboss@aguda.org.il"), ...form({ gift_id: "3", campus: "קפלן", starting_inventory: "99" }) });
    assert.equal((await gift(3, "קפלן")).starting_inventory, 30, "not another campus's sub-campus");
  });
});

describe("students with several campuses pick where to collect (request 57)", () => {
  const setTwo = (id: string, campuses: string[], sub: string | null = null) =>
    pool.query("UPDATE students SET campuses = $2, sub_campus = $3 WHERE national_id = $1", [id, campuses, sub]);

  test("after the survey they pick a campus, and the gifts come from its stock", async () => {
    await setTwo(ids[0], ["הר הצופים", "רחובות"]);
    const cookies = await login({ kind: "student", national_id: ids[0] });
    const choice = (await app.inject({ url: "/student", cookies })).body;
    assert.match(choice, /באיזה קמפוס תרצה לקבל את המתנה/);
    assert.match(choice, /value="הר הצופים">.*value="רחובות">/s);
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "campus_missing" });

    const none = await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({}) });
    assert.match(none.body, /בחר קמפוס\./);
    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "רחובות" }) });
    const s = await student(ids[0]);
    assert.equal(s.pickup_campus, "רחובות");
    assert.equal(s.stock_campus, "רחובות");
    const page = (await app.inject({ url: "/student", cookies })).body;
    assert.match(page, /הקמפוס לקבלת המתנה: <strong>רחובות<\/strong> · <a href="\/student\/campus">שנה את הקמפוס/);
    assert.equal((await selectGift(ids[0], 1)).ok, true);
    assert.equal((await gift(1, "רחובות")).requested_count, 1);
    assert.equal((await gift(1, "הר הצופים")).requested_count, 0);
  });

  test("the campus must be one of theirs, and is fixed once a gift is selected", async () => {
    await setTwo(ids[0], ["הר הצופים", "רחובות"]);
    const cookies = await login({ kind: "student", national_id: ids[0] });
    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "גבעת רם" }) });
    assert.equal((await student(ids[0])).chosen_campus, null, "not one of theirs");
    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "רחובות" }) });
    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "הר הצופים" }) });
    assert.equal((await student(ids[0])).chosen_campus, "הר הצופים", "changed before a selection");
    await selectGift(ids[0], 2);
    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "רחובות" }) });
    assert.equal((await student(ids[0])).chosen_campus, "הר הצופים", "fixed after the selection");
    assert.equal((await app.inject({ url: "/student/campus", cookies })).headers.location, "/student");
  });

  test("a student with one campus never sees the choice", async () => {
    const page = (await app.inject({ url: "/student", cookies: await login({ kind: "student", national_id: ids[1] }) })).body;
    assert.doesNotMatch(page, /באיזה קמפוס/);
    assert.doesNotMatch(page, /הקמפוס לקבלת המתנה/);
  });

  test("the desk of the picked campus serves the student; the first campus's desk does not", async () => {
    await setTwo(ids[0], ["הר הצופים", "גבעת רם"]);
    await pool.query("UPDATE students SET chosen_campus = 'גבעת רם' WHERE national_id = $1", [ids[0]]);
    await selectGift(ids[0], 1);
    assert.match((await lookup(await asStaff("givat@aguda.org.il"), ids[0])).body, /action="\/staff\/take"/);
    assert.match((await lookup(await asStaff("har@aguda.org.il"), ids[0])).body, /לעמדת החלוקה בקמפוס גבעת רם/);
  });

  test("a עין כרם sub-campus applies only when the student collects at עין כרם", async () => {
    await setTwo(ids[0], ["גבעת רם", "עין כרם"], "קפלן");
    assert.equal((await student(ids[0])).stock_campus, "גבעת רם", "no choice yet: the first campus");
    await pool.query("UPDATE students SET chosen_campus = 'עין כרם' WHERE national_id = $1", [ids[0]]);
    assert.equal((await student(ids[0])).stock_campus, "קפלן");
    await pool.query("UPDATE students SET chosen_campus = 'גבעת רם' WHERE national_id = $1", [ids[0]]);
    assert.equal((await student(ids[0])).stock_campus, "גבעת רם");
  });

  test("the ceo downloads the multi-campus gifts: campuses, pickup campus, gift, and receipt", async () => {
    await setTwo(ids[0], ["הר הצופים", "רחובות"]);
    await pool.query("UPDATE students SET chosen_campus = 'רחובות' WHERE national_id = $1", [ids[0]]);
    await selectGift(ids[0], 3);
    await markTaken(ids[0]);
    await selectGift(ids[1], 2); // one campus: not in the report
    const ceo = await asStaff("chief@aguda.org.il");
    assert.match((await app.inject({ url: "/manager", cookies: ceo })).body, /href="\/manager\/export\/multi_campus.csv"/);
    const csv = (await app.inject({ url: "/manager/export/multi_campus.csv", cookies: ceo })).body;
    assert.ok(csv.startsWith("\uFEFF"), "the UTF-8 marker for Excel");
    const lines = csv.slice(1).trimEnd().split("\r\n");
    assert.equal(lines[0], "national_id,first_name,last_name,campuses,pickup_campus,stock_campus,gift,received_at");
    assert.equal(lines.length, 2, "only the multi-campus student");
    assert.match(lines[1], new RegExp(`^${ids[0]},.*,הר הצופים \\+ רחובות,רחובות,רחובות,.+,\\d{4}-`));
  });
});

describe("the ceo resets every selection not handed over (request 59)", () => {
  test("only untaken selections are cleared, each stock point gets its units back", async () => {
    await setRehovot(ids[0]);
    await pool.query("UPDATE students SET campuses = '{עין כרם}', sub_campus = 'קפלן' WHERE national_id = $1", [ids[1]]);
    await selectGift(ids[0], 1); // רחובות, not taken
    await selectGift(ids[1], 1); // קפלן, not taken
    await selectGift(ids[2], 1); // הר הצופים, taken
    await selectGift(ids[3], 2); // הר הצופים, not taken
    await markTaken(ids[2]);
    const ceo = await asStaff("chief@aguda.org.il");

    const list = (await app.inject({ url: "/manager/gifts", cookies: ceo })).body;
    assert.match(list, /action="\/manager\/gifts\/reset-all"/);
    const confirm = await app.inject({ method: "POST", url: "/manager/gifts/reset-all", cookies: ceo, ...form({}) });
    assert.match(confirm.body, /בחירות שלא נמסרו: <bdi dir="ltr">3<\/bdi>/);
    assert.equal((await student(ids[0])).gift_id, 1, "the confirm page changes nothing");

    const done = await app.inject({ method: "POST", url: "/manager/gifts/reset-all", cookies: ceo, ...form({ confirm: "1" }) });
    assert.equal(done.headers.location, "/manager/gifts?done=reset_all&n=3");
    for (const id of [ids[0], ids[1], ids[3]]) assert.equal((await student(id)).gift_id, null, id);
    assert.equal((await student(ids[2])).gift_id, 1, "the handed-over gift stays");
    assert.ok((await student(ids[2])).gift_taken_at);
    assert.equal((await gift(1, "רחובות")).requested_count, 0);
    assert.equal((await gift(1, "קפלן")).requested_count, 0);
    assert.equal((await gift(1, TEST_CAMPUS)).requested_count, 1);
    assert.equal((await gift(2, TEST_CAMPUS)).requested_count, 0);
    assert.deepEqual(await counterDrift(), []);
    assert.equal((await selectGift(ids[0], 1)).ok, true, "the student selects again");

    await pool.query("UPDATE students SET gift_id = NULL WHERE national_id = $1", [ids[0]]);
    await pool.query("UPDATE gift_stock SET requested_count = 0 WHERE gift_id = 1 AND campus = 'רחובות'");
    const none = await app.inject({ method: "POST", url: "/manager/gifts/reset-all", cookies: ceo, ...form({}) });
    assert.equal(none.headers.location, "/manager/gifts?error=none_to_reset");
  });

  test("only a ceo can reset", async () => {
    await selectGift(ids[0], 1);
    for (const email of ["harboss@aguda.org.il", "har@aguda.org.il"]) {
      const res = await app.inject({ method: "POST", url: "/manager/gifts/reset-all", cookies: await asStaff(email), ...form({ confirm: "1" }) });
      assert.equal(res.statusCode, 403, email);
    }
    assert.equal((await student(ids[0])).gift_id, 1);
  });

  test("the gift page says a selection is valid only for its distribution day (request 60)", async () => {
    const page = (await app.inject({ url: "/student", cookies: await login({ kind: "student", national_id: ids[0] }) })).body;
    const note = page.indexOf("שים לב שבחירת המתנה תקפה רק ליום חלוקתה.");
    assert.ok(note > 0 && note < page.indexOf('class="gifts"'), "above the gifts");
  });
  test("the login page and the page after a selection show the party picture, linked to the tickets (request 66)", async () => {
    const ad = '<a class="party" href="https://go.aguda.org.il/2511-tickets" target="_blank" rel="noopener noreferrer"><img src="/img/party.webp" alt="כרטיסים למסיבה"></a>';
    assert.ok((await app.inject("/")).body.includes(ad), "the login page");
    const cookies = await login({ kind: "student", national_id: ids[0] });
    assert.ok(!(await app.inject({ url: "/student", cookies })).body.includes(ad), "not on the gift list");
    await selectGift(ids[0], 1);
    assert.ok((await app.inject({ url: "/student", cookies })).body.includes(ad), "after the selection");
    assert.match((await app.inject({ url: "/student", cookies })).body,
      /<div class="card"><p class="campus-big">.*<img src="\/img\/mt_scopus.jpg" alt="">הר הצופים<\/span><\/p>/, "the campus too (request 67)");
    assert.equal((await app.inject("/img/party.webp")).statusCode, 200);
  });
});

describe("the desk sees its own campus only", () => {
  test("a worker of another campus learns only the student's campus", async () => {
    await selectGift(ids[0], 1);
    const res = await lookup(await asStaff("givat@aguda.org.il"), ids[0]);
    assert.match(res.body, /שייך לקמפוס אחר\. הפנה אותו לעמדת החלוקה בקמפוס הר הצופים/);
    assert.doesNotMatch(res.body, /action="\/staff\/take"/);
    assert.doesNotMatch(res.body, /<dt>/, "no student card");
    assert.equal((await pool.query("SELECT failed_lookups FROM staff WHERE email = 'givat@aguda.org.il'")).rows[0].failed_lookups, 0,
      "a student of another campus is not a wrong ID");
  });

  test("a forged handout or deletion for another campus changes nothing", async () => {
    await selectGift(ids[0], 1);
    const cookies = await asStaff("givat@aguda.org.il");
    await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    await app.inject({ method: "POST", url: "/staff/reset", cookies, ...form({ national_id: ids[0], what: "all", confirm: "1" }) });
    const s = await student(ids[0]);
    assert.equal(s.gift_taken_at, null);
    assert.equal(s.gift_id, 1);
    assert.ok(s.survey);
  });

  test("the worker of the student's campus sees the card and hands the gift over", async () => {
    await selectGift(ids[0], 1);
    const cookies = await asStaff("har@aguda.org.il");
    assert.match((await lookup(cookies, ids[0])).body, /action="\/staff\/take"/);
    await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    assert.ok((await student(ids[0])).gift_taken_at);
  });

  test("a worker with no campus serves every campus (request 45)", async () => {
    await setRehovot(ids[0]);
    await selectGift(ids[0], 1);
    const cookies = await asStaff("allcampus@aguda.org.il");
    const desk = (await app.inject({ url: "/staff", cookies })).body;
    assert.match(desk, /allcampus@aguda\.org\.il<\/bdi> · כל הקמפוסים/);
    assert.match(desk, /<th>קמפוס<\/th>/, "the stock of every campus");
    assert.match((await lookup(cookies, ids[0])).body, /action="\/staff\/take"/);
    await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    assert.ok((await student(ids[0])).gift_taken_at);
  });

  test("an all-campus manager adds a worker to any campus, or to all", async () => {
    const cookies = await asStaff("allboss@aguda.org.il");
    const add = (body: Record<string, string>) => app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form(body) });
    assert.equal((await add({ email: "a@aguda.org.il", role: "worker", campus: "רחובות" })).headers.location, "/manager?done=added_worker");
    assert.equal((await add({ email: "b@aguda.org.il", role: "worker", campus: "" })).headers.location, "/manager?done=added_worker");
    assert.equal((await add({ email: "c@aguda.org.il", role: "worker", campus: "ירושלים" })).headers.location, "/manager?error=invalid_campus");
    const campuses = (await pool.query("SELECT email, campus FROM staff WHERE email IN ('a@aguda.org.il', 'b@aguda.org.il') ORDER BY email")).rows;
    assert.deepEqual(campuses, [{ email: "a@aguda.org.il", campus: "רחובות" }, { email: "b@aguda.org.il", campus: null }]);
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.match(page, /<select name="campus"><option value="">כל הקמפוסים<\/option>/);
    assert.match(page, /givat@aguda\.org\.il/, "sees every campus's staff");
    await app.inject({ method: "POST", url: "/manager/stock", cookies, ...form({ gift_id: "2", campus: "עין כרם", starting_inventory: "40" }) });
    assert.equal((await gift(2, "עין כרם")).starting_inventory, 40);
  });

  test("a one-campus manager cannot add a worker to all campuses", async () => {
    const res = await app.inject({
      method: "POST", url: "/manager/staff/add", cookies: await asStaff("harboss@aguda.org.il"),
      ...form({ email: "d@aguda.org.il", role: "worker", campus: "" }),
    });
    assert.equal(res.headers.location, "/manager?done=added_worker");
    assert.equal((await pool.query("SELECT campus FROM staff WHERE email = 'd@aguda.org.il'")).rows[0].campus, "הר הצופים");
    assert.doesNotMatch((await app.inject({ url: "/manager", cookies: await asStaff("harboss@aguda.org.il") })).body, /<select name="campus">/);
  });

  test("the desk stock shows the own campus; a ceo sees every campus", async () => {
    const worker = (await app.inject({ url: "/staff", cookies: await asStaff("givat@aguda.org.il") })).body;
    assert.match(worker, /givat@aguda\.org\.il<\/bdi> · גבעת רם/);
    assert.doesNotMatch(worker, /<th>קמפוס<\/th>/);
    const ceo = await asStaff("chief@aguda.org.il");
    const page = (await app.inject({ url: "/staff", cookies: ceo })).body;
    assert.match(page, /<th>קמפוס<\/th>/);
    for (const c of ["גבעת רם", "הר הצופים", "עין כרם", "רחובות"]) assert.match(page, new RegExp(`<tr><td>${c}</td>`));
    assert.match((await lookup(ceo, ids[0])).body, /<dt>/, "a ceo sees a student of any campus");
  });
});

describe("staff and stock per campus", () => {
  test("a manager's new worker joins the manager's campus, whatever the form says", async () => {
    const res = await app.inject({
      method: "POST", url: "/manager/staff/add", cookies: await asStaff("harboss@aguda.org.il"),
      ...form({ email: "new@aguda.org.il", role: "worker", campus: "רחובות" }),
    });
    assert.equal(res.headers.location, "/manager?done=added_worker");
    assert.equal((await pool.query("SELECT campus FROM staff WHERE email = 'new@aguda.org.il'")).rows[0].campus, "הר הצופים");
  });

  test("a manager sees and removes only their own campus's workers", async () => {
    const cookies = await asStaff("harboss@aguda.org.il");
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.match(page, /har@aguda\.org\.il/);
    assert.doesNotMatch(page, /givat@aguda\.org\.il/);
    const res = await app.inject({ method: "POST", url: "/manager/staff/remove", cookies, ...form({ email: "givat@aguda.org.il" }) });
    assert.equal(res.headers.location, "/manager?error=remove_forbidden");
    const move = await app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email: "givat@aguda.org.il", role: "worker" }) });
    assert.equal(move.headers.location, "/manager?error=other_campus");
    assert.equal((await pool.query("SELECT campus FROM staff WHERE email = 'givat@aguda.org.il'")).rows[0].campus, "גבעת רם");
  });

  test("a ceo names the campus, and moves a person to another campus", async () => {
    const cookies = await asStaff("chief@aguda.org.il");
    const add = (body: Record<string, string>) => app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form(body) });
    assert.equal((await add({ email: "x@aguda.org.il", role: "worker", campus: "ירושלים" })).headers.location, "/manager?error=invalid_campus");
    assert.equal((await add({ email: "allcampus@aguda.org.il", role: "worker", campus: "עין כרם" })).headers.location, "/manager?done=moved");
    assert.equal((await pool.query("SELECT campus FROM staff WHERE email = 'allcampus@aguda.org.il'")).rows[0].campus, "עין כרם");
  });

  test("a manager sets their own campus's stock only; a ceo sets any campus", async () => {
    const manager = await asStaff("harboss@aguda.org.il");
    await app.inject({ method: "POST", url: "/manager/stock", cookies: manager, ...form({ gift_id: "1", campus: "רחובות", starting_inventory: "50" }) });
    assert.equal((await gift(1, "הר הצופים")).starting_inventory, 50);
    assert.equal((await gift(1, "רחובות")).starting_inventory, 5);
    const ceo = await asStaff("chief@aguda.org.il");
    await app.inject({ method: "POST", url: "/manager/stock", cookies: ceo, ...form({ gift_id: "1", campus: "רחובות", starting_inventory: "70" }) });
    assert.equal((await gift(1, "רחובות")).starting_inventory, 70);
  });
});

describe("faculties of two campuses (request 65)", () => {
  test("a recompute adds the second campus; the student then picks, and the pick sets the stock", async () => {
    const ot = { motherFacultyName: 'ביה"ס לריפוי בעיסוק', faculty: 'ביה"ס לריפוי בעיסוק', roadMaps: [] };
    const dental = { motherFacultyName: "פקולטה לרפואת שיניים", faculty: "פקולטה לרפואת שיניים", roadMaps: [] };
    await pool.query("UPDATE students SET campuses = '{עין כרם}', sub_campus = 'ריפוי בעיסוק', programs = $2 WHERE national_id = $1", [ids[0], JSON.stringify([ot])]);
    await pool.query("UPDATE students SET campuses = '{עין כרם}', programs = $2 WHERE national_id = $1", [ids[1], JSON.stringify([dental])]);
    await pool.query("UPDATE students SET campuses = '{רחובות}', chosen_campus = 'רחובות' WHERE national_id = $1", [ids[2]]);
    const { recomputeCampuses } = await import("../src/university.ts");
    await recomputeCampuses();
    assert.deepEqual((await student(ids[0])).campuses, ["עין כרם", "הר הצופים"]);
    assert.equal((await student(ids[0])).sub_campus, "ריפוי בעיסוק");
    assert.deepEqual((await student(ids[1])).campuses, ["עין כרם", "גבעת רם"]);
    assert.deepEqual((await student(ids[2])).campuses, ["רחובות"], "no mapped faculty: the campuses stay");

    // ריפוי בעיסוק at הר הצופים takes the הר הצופים stock; at עין כרם, its own sub-campus stock.
    await pool.query("UPDATE students SET chosen_campus = 'הר הצופים' WHERE national_id = $1", [ids[0]]);
    assert.equal((await student(ids[0])).stock_campus, "הר הצופים");
    await pool.query("UPDATE students SET chosen_campus = 'עין כרם' WHERE national_id = $1", [ids[0]]);
    assert.equal((await student(ids[0])).stock_campus, "ריפוי בעיסוק");
    // The ceo's multi-campus report lists them once they select.
    await pool.query("UPDATE students SET chosen_campus = 'גבעת רם' WHERE national_id = $1", [ids[1]]);
    assert.equal((await selectGift(ids[1], 1)).ok, true);
    const report = (await pool.query("SELECT campuses, pickup_campus FROM multi_campus_gifts WHERE national_id = $1", [ids[1]])).rows;
    assert.deepEqual(report, [{ campuses: "עין כרם + גבעת רם", pickup_campus: "גבעת רם" }]);
  });
});

describe("מכון וולקני, a sub-campus that a רחובות student picks (request 68)", () => {
  test("a רחובות student picks רחובות or מכון וולקני, which has its own stock and the רחובות logo and staff", async () => {
    await setCampuses(ids[0], ["רחובות"]);
    await pool.query("INSERT INTO staff (email, role, campus) VALUES ('rehovot@aguda.org.il', 'worker', 'רחובות')");
    await pool.query("UPDATE gift_stock SET starting_inventory = 5 WHERE gift_id = 1 AND campus = 'מכון וולקני'");
    const cookies = await login({ kind: "student", national_id: ids[0] });
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "campus_missing" }, "no pick yet");
    const choice = (await app.inject({ url: "/student", cookies })).body;
    assert.match(choice, /באיזה קמפוס תרצ[הי] לקבל את המתנה\?/);
    assert.match(choice, /value="רחובות">.*value="מכון וולקני">/s);

    await app.inject({ method: "POST", url: "/student/campus", cookies, ...form({ campus: "מכון וולקני" }) });
    const s = await student(ids[0]);
    assert.equal(s.chosen_campus, "מכון וולקני");
    assert.equal(s.stock_campus, "מכון וולקני");
    assert.equal((await selectGift(ids[0], 1)).ok, true);
    assert.equal((await gift(1, "מכון וולקני")).requested_count, 1);
    assert.equal((await gift(1, "רחובות")).requested_count, 0);

    const page = (await app.inject({ url: "/student", cookies })).body;
    assert.match(page, /<img src="\/img\/rechovot.jpg" alt="">מכון וולקני<\/span>/, "the רחובות logo");
    const desk = await asStaff("rehovot@aguda.org.il");
    assert.match((await lookup(desk, ids[0])).body, /action="\/staff\/take"/, "the רחובות desk serves it");
    assert.doesNotMatch((await lookup(await asStaff("har@aguda.org.il"), ids[0])).body, /action="\/staff\/take"/);

    const report = (await pool.query("SELECT pickup_campus, stock_campus FROM multi_campus_gifts WHERE national_id = $1", [ids[0]])).rows;
    assert.deepEqual(report, [{ pickup_campus: "מכון וולקני", stock_campus: "מכון וולקני" }], "in the multi-campus report");
  });

  test("another campus cannot pick מכון וולקני", async () => {
    await setCampuses(ids[0], ["גבעת רם"]);
    const { chooseCampus } = await import("../src/gifts.ts");
    assert.deepEqual(await chooseCampus(ids[0], "מכון וולקני"), { ok: false, reason: "not_theirs" });
  });
});
