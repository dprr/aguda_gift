// M4: the student page and the staff page, driven through real HTTP requests.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { markTaken, selectGift } from "../src/gifts.ts";
import { migrate } from "../src/migrate.ts";
import { GIFTS } from "../src/seed.ts";
import { buildApp } from "../src/server.ts";
import { freshDatabase, gift, loadStudents, setMember, student } from "./helpers.ts";

after(() => pool.end());

const ORIGIN = "http://localhost:3000";
const noGoogle: GoogleLogin = {
  start: async () => { throw new Error("not used"); },
  finish: async () => { throw new Error("not used"); },
};
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const form = (body: Record<string, string>) => ({
  payload: new URLSearchParams(body).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});

/** Log in through the development login and return the session cookie. */
async function login(body: Record<string, string>): Promise<{ session: string }> {
  const res = await app.inject({ method: "POST", url: "/auth/dev", ...form(body) });
  const session = res.cookies.find((c) => c.name === "session")?.value;
  assert.ok(session, `login failed: ${res.headers.location}`);
  return { session };
}
const asStudent = (id: string) => login({ kind: "student", national_id: id });
/** A worker. */
const asStaff = () => login({ kind: "staff", email: "dana@aguda.org.il" });
const asManager = () => login({ kind: "staff", email: "boss@aguda.org.il" });

let ids: string[];
beforeEach(async () => {
  await freshDatabase(5);
  ids = await loadStudents(10, 8); // students 0-7 are members, 8-9 are not
  await pool.query("INSERT INTO staff (email, role) VALUES ('dana@aguda.org.il', 'worker'), ('boss@aguda.org.il', 'manager')");
  app = await buildApp({
    google: noGoogle,
    sessionSecret: "test-secret-test-secret-test-secret",
    domains: { student: ["mail.huji.ac.il"], staff: ["mail.huji.ac.il", "aguda.org.il"] },
    devLogin: true,
    production: false,
    origin: ORIGIN,
  });
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

// ---- student ---------------------------------------------------------------------------

describe("student page", () => {
  test("a member with no selection sees the four gifts", async () => {
    const res = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.equal(res.statusCode, 200);
    assert.equal(count(res.body, 'href="/student/confirm?gift='), 4);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("a gift with a photo shows it, and the photo is served", async () => {
    await pool.query("UPDATE gifts SET image = 'backpack.jpeg' WHERE id = 1");
    const cookies = await asStudent(ids[0]);
    const res = await app.inject({ url: "/student", cookies });
    assert.equal(count(res.body, '<img src="/img/backpack.jpeg"'), 1, "only gift 1 has a photo");
    const confirm = await app.inject({ url: "/student/confirm?gift=1", cookies });
    assert.match(confirm.body, /<img class="photo" src="\/img\/backpack.jpeg"/);

    const image = await app.inject({ url: "/img/backpack.jpeg" });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
  });

  test("every seeded gift's photo exists, and nothing outside img/ is served", async () => {
    for (const g of GIFTS) {
      assert.equal((await app.inject({ url: `/img/${g.image}` })).statusCode, 200, g.name);
    }
    for (const url of ["/img/..%2Fpackage.json", "/img/../package.json", "/img/missing.jpeg"]) {
      assert.equal((await app.inject({ url })).statusCode, 404, url);
    }
  });

  test("a sold-out gift is shown but cannot be chosen (request 19)", async () => {
    await pool.query("UPDATE gifts SET requested_count = starting_inventory WHERE id = 2");
    const res = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.equal(count(res.body, 'href="/student/confirm?gift='), 3);
    assert.doesNotMatch(res.body, /confirm\?gift=2"/);
    assert.match(res.body, /class="gift out"/);
  });

  test("choosing takes a confirm step, then the selection is locked (request 3)", async () => {
    const cookies = await asStudent(ids[0]);
    const confirm = await app.inject({ url: "/student/confirm?gift=3", cookies });
    assert.match(confirm.body, /action="\/student\/select"/);
    assert.match(confirm.body, /name="gift_id" value="3"/);

    const post = await app.inject({ method: "POST", url: "/student/select", cookies, ...form({ gift_id: "3" }) });
    assert.equal(post.headers.location, "/student?saved=1");

    const page = await app.inject({ url: "/student", cookies });
    assert.equal(count(page.body, "/student/confirm?gift="), 0, "no gift can be chosen any more");
    assert.match(page.body, /תיק בד/);
    assert.equal((await student(ids[0])).gift_id, 3);
  });

  test("a gift that sells out between the page and the click is explained", async () => {
    const cookies = await asStudent(ids[0]);
    await pool.query("UPDATE gifts SET requested_count = starting_inventory WHERE id = 1");
    const post = await app.inject({ method: "POST", url: "/student/select", cookies, ...form({ gift_id: "1" }) });
    assert.equal(post.headers.location, "/student?error=sold_out");
    const page = await app.inject({ url: post.headers.location as string, cookies });
    assert.match(page.body, /אזלה הרגע/);
    assert.equal(count(page.body, "/student/confirm?gift="), 3, "the student can pick another");
  });

  test("a non-member and an unknown member see no gifts", async () => {
    await setMember(ids[1], null);
    for (const id of [ids[9], ids[1]]) {
      const res = await app.inject({ url: "/student", cookies: await asStudent(id) });
      assert.equal(count(res.body, "/student/confirm?gift="), 0);
      assert.match(res.body, /class="warn"/);
    }
  });

  test("a lapsed member with a selection is told to renew (request 20)", async () => {
    await selectGift(ids[0], 2);
    await setMember(ids[0], false);
    const res = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.match(res.body, /כדי לקבל את המתנה, חדש(י)? את החברות/);
  });

  test("a collected gift is shown as received", async () => {
    await selectGift(ids[0], 4);
    await markTaken(ids[0]);
    const res = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.match(res.body, /קיבלת את המתנה/);
  });

  test("a student can only act for itself: a national ID in the request is ignored", async () => {
    const cookies = await asStudent(ids[0]);
    await app.inject({ method: "POST", url: "/student/select", cookies, ...form({ gift_id: "1", national_id: ids[1] }) });
    assert.equal((await student(ids[0])).gift_id, 1);
    assert.equal((await student(ids[1])).gift_id, null);
  });
});

// ---- staff -----------------------------------------------------------------------------

describe("staff page", () => {
  test("search finds a student by national ID, by POST", async () => {
    await selectGift(ids[0], 2);
    const cookies = await asStaff();
    const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: ` ${ids[0]} ` }) });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /ספל/);
    assert.match(res.body, /action="\/staff\/take"/);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("an unknown ID says so", async () => {
    const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies: await asStaff(), ...form({ national_id: "999" }) });
    assert.match(res.body, /לא מצאנו סטודנט/);
  });

  test("marking as taken works once; the second desk is told, and nothing is counted twice", async () => {
    await selectGift(ids[0], 2);
    const cookies = await asStaff();
    const first = await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    assert.match(first.body, /class="ok"/);
    assert.doesNotMatch(first.body, /action="\/staff\/take"/, "no button after the handout");

    const second = await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    assert.match(second.body, /לפני רגע/, "a repeat within two minutes is treated as a lost response");
    assert.equal((await gift(2)).given_count, 1);
  });

  test("an old repeat is an alarm, not a reassurance", async () => {
    await selectGift(ids[0], 2);
    await markTaken(ids[0]);
    await pool.query("UPDATE students SET gift_taken_at = now() - interval '1 hour' WHERE national_id = $1", [ids[0]]);
    const res = await app.inject({ method: "POST", url: "/staff/take", cookies: await asStaff(), ...form({ national_id: ids[0] }) });
    assert.match(res.body, /אל תמסור אותה שוב/);
  });

  test("no button for a student with no selection, or for a lapsed member (requests 6, 20)", async () => {
    await selectGift(ids[1], 3);
    await setMember(ids[1], false);
    const cookies = await asStaff();
    for (const id of [ids[0], ids[1]]) {
      const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: id }) });
      assert.doesNotMatch(res.body, /action="\/staff\/take"/);
    }
    // And a forced POST is still refused by the server.
    const forced = await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[1] }) });
    assert.match(forced.body, /אל תמסור את המתנה/);
    assert.equal((await gift(3)).given_count, 0);
  });

  test("the stock table shows each gift's counts", async () => {
    await selectGift(ids[0], 1);
    await selectGift(ids[1], 1);
    const res = await app.inject({ url: "/staff", cookies: await asStaff() });
    assert.match(res.body, /<td>קפוצ&#39;ון<\/td><td><bdi dir="ltr">5<\/bdi><\/td><td><bdi dir="ltr">2<\/bdi><\/td>/);
  });

  test("counter drift is shown as an error", async () => {
    await pool.query("UPDATE gifts SET given_count = 3 WHERE id = 4");
    const res = await app.inject({ url: "/staff", cookies: await asStaff() });
    assert.match(res.body, /המונים אינם תואמים/);
  });

  test("a national ID never appears in a staff URL", async () => {
    const cookies = await asStaff();
    const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: ids[0] }) });
    assert.equal(res.headers.location, undefined, "search answers with a page, not a redirect");
    for (const m of res.body.matchAll(/(?:href|action)="([^"]*)"/g)) {
      assert.ok(!m[1].includes(ids[0]), `national ID in ${m[1]}`);
    }
  });
});

// ---- manager (request 24) ---------------------------------------------------------------

describe("manager page", () => {
  const workers = async () =>
    (await pool.query("SELECT email FROM staff WHERE role = 'worker' ORDER BY email")).rows.map((r) => r.email);
  const notice = async (location: string, cookies: { session: string }) =>
    (await app.inject({ url: location, cookies })).body.match(/<p class="(?:ok|error)">([^<]*(?:<bdi[^>]*>[^<]*<\/bdi>[^<]*)?)<\/p>/)?.[1];

  test("a manager adds a worker, and the worker can then log in", async () => {
    const cookies = await asManager();
    const res = await app.inject({ method: "POST", url: "/manager/workers/add", cookies, ...form({ email: " New@Mail.HUJI.ac.il " }) });
    assert.equal(res.headers.location, "/manager?done=added");
    assert.equal(await notice(res.headers.location as string, cookies), "הוספנו את העובד.");
    assert.deepEqual(await workers(), ["dana@aguda.org.il", "new@mail.huji.ac.il"]);
    await login({ kind: "staff", email: "new@mail.huji.ac.il" });
  });

  test("a worker address must be a valid university or Aguda address, new, and not a manager", async () => {
    const cookies = await asManager();
    for (const [email, error] of [
      ["not-an-email", "invalid"],
      ["x@gmail.com", "wrong_domain"],
      ["dana@aguda.org.il", "exists"],
      ["BOSS@aguda.org.il", "manager"],
    ]) {
      const res = await app.inject({ method: "POST", url: "/manager/workers/add", cookies, ...form({ email }) });
      assert.equal(res.headers.location, `/manager?error=${error}`, email);
    }
    assert.deepEqual(await workers(), ["dana@aguda.org.il"]);
  });

  test("the migration moves workers from the first version's table into staff", async () => {
    await pool.query("CREATE TABLE workers (email text PRIMARY KEY); INSERT INTO workers VALUES ('old@aguda.org.il')");
    await migrate();
    assert.equal((await pool.query("SELECT role FROM staff WHERE email = 'old@aguda.org.il'")).rows[0].role, "worker");
    assert.equal((await pool.query("SELECT to_regclass('workers') AS t")).rows[0].t, null);
  });

  test("the manager page cannot remove a manager", async () => {
    const res = await app.inject({ method: "POST", url: "/manager/workers/remove", cookies: await asManager(), ...form({ email: "boss@aguda.org.il" }) });
    assert.equal(res.headers.location, "/manager?error=not_found");
    assert.equal((await pool.query("SELECT role FROM staff WHERE email = 'boss@aguda.org.il'")).rows[0].role, "manager");
  });

  test("a manager removes a worker, and the worker is locked out at once", async () => {
    const worker = await asStaff();
    const res = await app.inject({ method: "POST", url: "/manager/workers/remove", cookies: await asManager(), ...form({ email: "dana@aguda.org.il" }) });
    assert.equal(res.headers.location, "/manager?done=removed");
    assert.deepEqual(await workers(), []);
    assert.equal((await app.inject({ url: "/staff", cookies: worker })).headers.location, "/staff/login?error=not_staff");
  });

  test("the manager page lists all the staff with their roles, and each gift's stock", async () => {
    const res = await app.inject({ url: "/manager", cookies: await asManager() });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /boss@aguda\.org\.il<\/bdi><\/td><td>מנהל<\/td><td><\/td>/, "a manager has no remove button");
    assert.match(res.body, /dana@aguda\.org\.il<\/bdi><\/td><td>עובד<\/td><td><form[^>]*workers\/remove/);
    assert.equal(res.body.split('action="/manager/stock"').length - 1, 4);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("a worker cannot use any manager route, and nothing changes", async () => {
    const cookies = await asStaff();
    for (const [url, body] of [
      ["/manager/workers/add", { email: "x@aguda.org.il" }],
      ["/manager/workers/remove", { email: "dana@aguda.org.il" }],
      ["/manager/stock", { gift_id: "1", starting_inventory: "99" }],
    ] as const) {
      assert.equal((await app.inject({ method: "POST", url, cookies, ...form(body) })).statusCode, 403, url);
    }
    assert.equal((await app.inject({ url: "/manager", cookies })).statusCode, 403);
    assert.deepEqual(await workers(), ["dana@aguda.org.il"]);
    assert.equal((await gift(1)).starting_inventory, 5);
  });

  test("a manager sets the stock, but never below what students already selected", async () => {
    const cookies = await asManager();
    await selectGift(ids[0], 1);
    await selectGift(ids[1], 1);
    const set = (value: string) =>
      app.inject({ method: "POST", url: "/manager/stock", cookies, ...form({ gift_id: "1", starting_inventory: value }) });

    assert.equal((await set("20")).headers.location, "/manager?done=stock");
    assert.equal((await gift(1)).starting_inventory, 20);

    const low = await set("1");
    assert.equal(low.headers.location, "/manager?error=below_requested&min=2");
    assert.match((await notice(low.headers.location as string, cookies))!, /הזן לפחות <bdi dir="ltr">2<\/bdi>/);
    assert.equal((await gift(1)).starting_inventory, 20);

    for (const bad of ["-1", "abc", "", "1.5"]) {
      assert.equal((await set(bad)).headers.location, "/manager?error=invalid_stock", bad);
    }

    // Down to exactly the selections: the gift is now sold out for everyone else.
    assert.equal((await set("2")).headers.location, "/manager?done=stock");
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[2]) });
    assert.doesNotMatch(page.body, /confirm\?gift=1"/);
  });
});

// ---- cross-site requests ---------------------------------------------------------------

describe("CSRF", () => {
  test("a POST from another origin is refused", async () => {
    await selectGift(ids[0], 2);
    const cookies = await asStaff();
    const res = await app.inject({
      method: "POST", url: "/staff/take", cookies,
      ...form({ national_id: ids[0] }),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.aguda.org.il" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal((await gift(2)).given_count, 0);
  });

  test("a POST from this origin is accepted", async () => {
    await selectGift(ids[0], 2);
    const res = await app.inject({
      method: "POST", url: "/staff/take", cookies: await asStaff(),
      ...form({ national_id: ids[0] }),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((await gift(2)).given_count, 1);
  });
});

// ---- gender (.claude/skills/hebrew-text) ------------------------------------------------
// A known woman gets the feminine form. Masculine is the neutral form only when the gender
// is unknown.

describe("gendered forms", () => {
  const setGender = (id: string, gender: string | null) =>
    pool.query("UPDATE students SET gender = $2 WHERE national_id = $1", [id, gender]);

  test("isFemale recognises the known codes, and treats anything else as unknown", async () => {
    const { isFemale } = await import("../src/pages.ts");
    for (const g of ["נקבה", "F", " female "]) assert.equal(isFemale(g), true, g);
    for (const g of ["זכר", "M", "1", "", null]) assert.equal(isFemale(g), false, String(g));
  });

  test("the membership label follows the stored gender", async () => {
    await setGender(ids[0], "נקבה");
    await setGender(ids[1], "זכר");
    await setGender(ids[2], null);
    const page = async (id: string) => (await app.inject({ url: "/student", cookies: await asStudent(id) })).body;
    assert.match(await page(ids[0]), /<strong>חברת אגודה<\/strong>/);
    assert.match(await page(ids[1]), /<strong>חבר אגודה<\/strong>/);
    assert.match(await page(ids[2]), /<strong>חבר אגודה<\/strong>/, "unknown gender is masculine");
  });

  test("a female non-member is told אינך חברת אגודה", async () => {
    await setGender(ids[9], "נקבה");
    const res = await app.inject({ url: "/student", cookies: await asStudent(ids[9]) });
    assert.match(res.body, /אינך חברת אגודה/);
  });

  test("the staff card and the refusal use the student's gender", async () => {
    await selectGift(ids[0], 1);
    await setMember(ids[0], false);
    await setGender(ids[0], "נקבה");
    const cookies = await asStaff();
    const card = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: ids[0] }) });
    assert.match(card.body, /לא חברת אגודה/);
    assert.match(card.body, /הסטודנטית אינה חברת אגודה/);
    const forced = await app.inject({ method: "POST", url: "/staff/take", cookies, ...form({ national_id: ids[0] }) });
    assert.match(forced.body, /הסטודנטית אינה חברת אגודה/);
  });
});

describe("logout button", () => {
  const setGender = (id: string, gender: string | null) =>
    pool.query("UPDATE students SET gender = $2 WHERE national_id = $1", [id, gender]);
  const button = (html: string) => html.match(/action="\/auth\/logout"><button[^>]*>([^<]+)</)?.[1];

  test("imperative, gendered for the student; masculine for staff", async () => {
    await setGender(ids[0], "נקבה");
    await setGender(ids[1], "זכר");
    await setGender(ids[2], null);
    const page = async (id: string) => (await app.inject({ url: "/student", cookies: await asStudent(id) })).body;
    assert.equal(button(await page(ids[0])), "התנתקי");
    assert.equal(button(await page(ids[1])), "התנתק");
    assert.equal(button(await page(ids[2])), "התנתק", "unknown gender is masculine");
    assert.equal(button((await app.inject({ url: "/staff", cookies: await asStaff() })).body), "התנתק");
  });
});

describe("buttons use the imperative (.claude/skills/hebrew-text)", () => {
  const setGender = (id: string, gender: string | null) =>
    pool.query("UPDATE students SET gender = $2 WHERE national_id = $1", [id, gender]);
  /** The visible text of every <button> and every link styled as a button. */
  const labels = (html: string) =>
    [...html.matchAll(/<(?:button|a)[^>]*class="button[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());

  test("the login page", async () => {
    const l = labels((await app.inject("/")).body);
    assert.ok(l.includes("התחבר עם חשבון mail.huji.ac.il"), l.join(" | "));
    assert.ok(l.includes("היכנס"), l.join(" | "));
  });

  test("the student pages, by gender", async () => {
    await setGender(ids[0], "נקבה");
    await setGender(ids[1], "זכר");
    for (const [id, expected] of [
      [ids[0], ["בחרי", "אשרי את הבחירה", "חזרי"]],
      [ids[1], ["בחר", "אשר את הבחירה", "חזור"]],
    ] as const) {
      const cookies = await asStudent(id);
      const gifts = labels((await app.inject({ url: "/student", cookies })).body);
      const confirm = labels((await app.inject({ url: "/student/confirm?gift=1", cookies })).body);
      assert.ok(gifts.includes(expected[0]), gifts.join(" | "));
      assert.ok(confirm.includes(expected[1]) && confirm.includes(expected[2]), confirm.join(" | "));
    }
  });

  test("the staff page", async () => {
    await selectGift(ids[0], 1);
    const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies: await asStaff(), ...form({ national_id: ids[0] }) });
    const l = labels(res.body);
    assert.ok(l.includes("חפש") && l.includes("סמן כנמסרה"), l.join(" | "));
  });

  test("no button anywhere is a verbal noun", async () => {
    await selectGift(ids[2], 2);
    const staff = await asStaff();
    const pages = [
      (await app.inject("/")).body,
      (await app.inject({ url: "/student", cookies: await asStudent(ids[0]) })).body,
      (await app.inject({ url: "/student/confirm?gift=1", cookies: await asStudent(ids[0]) })).body,
      (await app.inject({ method: "POST", url: "/staff/lookup", cookies: staff, ...form({ national_id: ids[2] }) })).body,
    ];
    const nouns = ["התנתקות", "התחברות", "כניסה", "בחירה", "אישור", "חזרה", "חיפוש", "סימון"];
    for (const label of pages.flatMap(labels)) {
      for (const noun of nouns) assert.ok(!label.startsWith(noun), `button "${label}" starts with the noun ${noun}`);
    }
  });
});
