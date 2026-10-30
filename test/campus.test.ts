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
    await setCampuses(ids[0], ["רחובות"]);
    assert.equal((await selectGift(ids[0], 2)).ok, true);
    assert.equal((await gift(2, "רחובות")).requested_count, 1);
    assert.equal((await gift(2, TEST_CAMPUS)).requested_count, 0);
  });

  test("a gift sold out on the student's campus is sold out for them, even with stock elsewhere", async () => {
    await setCampuses(ids[0], ["רחובות"]);
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 1 AND campus = 'רחובות'");
    assert.deepEqual(await selectGift(ids[0], 1), { ok: false, reason: "sold_out" });
    assert.equal((await selectGift(ids[1], 1)).ok, true, "a student of another campus still selects it");
  });

  test("the student page shows the student's own campus stock", async () => {
    await setCampuses(ids[0], ["רחובות"]);
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
    await setCampuses(ids[0], ["רחובות"]);
    await selectGift(ids[0], 4);
    assert.equal((await markTaken(ids[0])).ok, true);
    assert.equal((await gift(4, "רחובות")).given_count, 1);
    assert.equal((await gift(4, TEST_CAMPUS)).given_count, 0);
    assert.deepEqual(await counterDrift(), []);
  });

  test("the seed holds the owner's stock on the 4 campuses, and 0 on the 3 sub-campuses", () => {
    assert.deepEqual(Object.keys(STOCK).sort(), ["אסף הרופא", "גבעת רם", "הר הצופים", "עין כרם", "קפלן", "רחובות", "ריפוי בעיסוק"]);
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
    await setCampuses(ids[0], ["רחובות"]);
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
