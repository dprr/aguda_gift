// M4: the student page and the staff page, driven through real HTTP requests.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { counterDrift, markTaken, selectGift } from "../src/gifts.ts";
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
  await pool.query("INSERT INTO staff (email, role, campus) VALUES ('dana@aguda.org.il', 'worker', 'הר הצופים'), ('boss@aguda.org.il', 'manager', 'הר הצופים')");
  app = await buildApp({
    google: noGoogle,
    sessionSecret: "test-secret-test-secret-test-secret",
    domains: { student: ["mail.huji.ac.il"], staff: ["mail.huji.ac.il", "aguda.org.il"] },
    devLogin: true,
    production: false,
    origin: ORIGIN,
    ceos: ["chief@aguda.org.il", "chief2@aguda.org.il"],
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

  test("the logos and the Heebo font are served with their types", async () => {
    for (const [url, type] of [
      ["/img/logo.png", "image/png"], ["/img/givat_ram.webp", "image/webp"],
      ["/img/mt_scopus.jpg", "image/jpeg"], ["/fonts/heebo-hebrew.woff2", "font/woff2"],
    ]) {
      const res = await app.inject({ url });
      assert.equal(res.statusCode, 200, url);
      assert.equal(res.headers["content-type"], type, url);
    }
    assert.equal((await app.inject({ url: "/fonts/OFL.txt" })).statusCode, 404, "only font files");
    assert.equal((await app.inject({ url: "/fonts/..%2Fpackage.json" })).statusCode, 404);
  });

  test("the student header shows the true campus's logo", async () => {
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.match(page.body, /<div class="bar"><img class="logo" src="\/img\/mt_scopus.jpg" alt="הר הצופים">/);
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
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 2");
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
    assert.match(page.body, /המתנה שמורה עבורך רק להיום/, "request 48");
    assert.match(page.body, /תיק בד/);
    assert.equal((await student(ids[0])).gift_id, 3);
  });

  test("a gift that sells out between the page and the click is explained", async () => {
    const cookies = await asStudent(ids[0]);
    await pool.query("UPDATE gift_stock SET requested_count = starting_inventory WHERE gift_id = 1");
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

  test("a non-member who answered the survey sees how to register, not the gifts (request 37)", async () => {
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[8]) });
    assert.match(page.body, /<a href="\/img\/how_to_register.jpg" target="_blank"><img class="register" src="\/img\/how_to_register.jpg" alt="[^"]+">/);
    assert.match(page.body, /כדי להירשם לאגודה, עקוב אחרי השלבים בתמונה/);
    assert.equal(count(page.body, "/student/confirm?gift="), 0);
    // Request 47: the Instagram post, at the top, before the "not a member" message.
    const post = page.body.indexOf('href="https://www.instagram.com/p/DecMEG_jLYt/?xtok=MXIzbmdubGYzbms3Nw==" target="_blank" rel="noopener noreferrer">צפה בפוסט שלנו באינסטגרם');
    assert.ok(post > 0 && post < page.body.indexOf("אינך חבר אגודה"));
    const image = await app.inject({ url: "/img/how_to_register.jpg" });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.ok(image.rawPayload.length < 600_000, "a web-sized copy, not the 7.7 MB original");

    const member = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.doesNotMatch(member.body, /how_to_register/, "a member sees the gifts instead");
    assert.doesNotMatch(member.body, /DecMEG_jLYt/);
  });

  test("a non-member sees the survey first, and the registration image only after it", async () => {
    await pool.query("UPDATE students SET survey = NULL, gender = 'Female' WHERE national_id = $1", [ids[8]]);
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[8]) });
    assert.match(page.body, /action="\/student\/survey"/);
    assert.doesNotMatch(page.body, /how_to_register/);
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

  test("a student marks the gift as received, which counts as a handout (request 26)", async () => {
    await selectGift(ids[0], 2);
    const cookies = await asStudent(ids[0]);
    const page = await app.inject({ url: "/student", cookies });
    assert.match(page.body, /href="\/student\/received">סמן שקיבלת את המתנה/);

    const confirm = await app.inject({ url: "/student/received", cookies });
    assert.match(confirm.body, /action="\/student\/received"/);
    assert.equal((await student(ids[0])).gift_taken_at, null, "the confirm page changes nothing");

    const post = await app.inject({ method: "POST", url: "/student/received", cookies });
    assert.equal(post.headers.location, "/student?received=1");
    const s = await student(ids[0]);
    assert.ok(s.gift_taken_at);
    assert.deepEqual(s.interactions.map((i: { type: string; gift_id: number }) => [i.type, i.gift_id]), [["gift_collection", 2]]);
    assert.equal((await gift(2)).given_count, 1);
    assert.match((await app.inject({ url: post.headers.location as string, cookies })).body, /שמרנו שקיבלת את המתנה/);

    // A second click, and then the desk: neither counts it again.
    await app.inject({ method: "POST", url: "/student/received", cookies });
    const desk = await app.inject({ method: "POST", url: "/staff/take", cookies: await asStaff(), ...form({ national_id: ids[0] }) });
    assert.match(desk.body, /class="(?:warn|error)"/);
    assert.equal((await gift(2)).given_count, 1);
  });

  test("no received button, and no effect, without an open selection or as a lapsed member", async () => {
    await selectGift(ids[1], 1);
    await setMember(ids[1], false);
    for (const id of [ids[0], ids[1]]) { // ids[0]: no selection; ids[1]: lapsed
      const cookies = await asStudent(id);
      assert.doesNotMatch((await app.inject({ url: "/student", cookies })).body, /\/student\/received/);
      assert.equal((await app.inject({ url: "/student/received", cookies })).headers.location, "/student");
      assert.equal((await app.inject({ method: "POST", url: "/student/received", cookies })).headers.location, "/student");
      assert.equal((await student(id)).gift_taken_at, null);
    }
    assert.equal((await gift(1)).given_count, 0);
  });

  test("the received button and its confirm page use the feminine form for a woman", async () => {
    await selectGift(ids[0], 1);
    await pool.query("UPDATE students SET gender = 'נקבה' WHERE national_id = $1", [ids[0]]);
    const cookies = await asStudent(ids[0]);
    assert.match((await app.inject({ url: "/student", cookies })).body, /סמני שקיבלת את המתנה/);
    const confirm = (await app.inject({ url: "/student/received", cookies })).body;
    assert.match(confirm, /אשרי שקיבלת את המתנה/);
    assert.match(confirm, /לא תוכלי לבטל/);
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

  test("search ignores leading zeros, as the university drops them (request 27)", async () => {
    await pool.query("UPDATE students SET national_id = '12345678' WHERE national_id = $1", [ids[0]]);
    for (const typed of ["012345678", "12345678", " 0012345678 "]) {
      const res = await app.inject({ method: "POST", url: "/staff/lookup", cookies: await asStaff(), ...form({ national_id: typed }) });
      assert.match(res.body, /<bdi dir="ltr">12345678<\/bdi>/, typed);
    }
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
    await pool.query("UPDATE gift_stock SET given_count = 3 WHERE gift_id = 4 AND campus = 'הר הצופים'");
    const res = await app.inject({ url: "/staff", cookies: await asStaff() });
    assert.match(res.body, /המונים אינם תואמים/);
  });

  test("any staff member deletes a selection, after a confirm step (request 30)", async () => {
    await selectGift(ids[0], 2);
    const cookies = await asStaff(); // a worker
    const card = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: ids[0] }) });
    assert.match(card.body, /name="what" value="gift">\s*<button class="button secondary">מחק את בחירת המתנה/);
    assert.match(card.body, /name="what" value="all">\s*<button class="button secondary">מחק את הסקר ואת בחירת המתנה/);

    const confirm = await app.inject({ method: "POST", url: "/staff/reset", cookies, ...form({ national_id: ids[0], what: "gift" }) });
    assert.match(confirm.body, /אישור מחיקה/);
    assert.match(confirm.body, /name="confirm" value="1"/);
    assert.equal((await student(ids[0])).gift_id, 2, "the confirm page changes nothing");

    const done = await app.inject({ method: "POST", url: "/staff/reset", cookies, ...form({ national_id: ids[0], what: "gift", confirm: "1" }) });
    assert.match(done.body, /מחקנו. הסטודנט יכול להתחיל מחדש./);
    assert.equal((await student(ids[0])).gift_id, null);
    assert.equal((await gift(2)).requested_count, 0);
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.equal(count(page.body, 'href="/student/confirm?gift='), 4, "the student selects again");
  });

  test("deleting the survey and the selection sends the student back to the survey", async () => {
    await selectGift(ids[0], 1);
    const res = await app.inject({ method: "POST", url: "/staff/reset", cookies: await asStaff(), ...form({ national_id: ids[0], what: "all", confirm: "1" }) });
    assert.match(res.body, /class="ok"/);
    assert.match(res.body, /name="national_id"/, "the card stays on the page");
    const page = await app.inject({ url: "/student", cookies: await asStudent(ids[0]) });
    assert.match(page.body, /action="\/student\/survey"/);
  });

  test("no delete buttons after the handout, and a forced request deletes nothing", async () => {
    await selectGift(ids[0], 3);
    await markTaken(ids[0]);
    const cookies = await asStaff();
    const card = await app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id: ids[0] }) });
    assert.doesNotMatch(card.body, /\/staff\/reset/);
    const forced = await app.inject({ method: "POST", url: "/staff/reset", cookies, ...form({ national_id: ids[0], what: "all", confirm: "1" }) });
    assert.match(forced.body, /כבר קיבל את המתנה, ולכן לא מחקנו דבר/);
    assert.equal((await student(ids[0])).gift_id, 3);
    assert.equal((await app.inject({ method: "POST", url: "/staff/reset", cookies, ...form({ national_id: ids[0], what: "drop" }) })).statusCode, 400);
  });

  test("a student cannot use the delete route", async () => {
    await selectGift(ids[0], 1);
    const res = await app.inject({ method: "POST", url: "/staff/reset", cookies: await asStudent(ids[0]), ...form({ national_id: ids[0], what: "gift", confirm: "1" }) });
    assert.equal(res.statusCode, 403);
    assert.equal((await student(ids[0])).gift_id, 1);
  });

  test("five wrong IDs in a row remove the staff member and alert the ceo (requests 34, 35)", async () => {
    const cookies = await asStaff();
    const search = (national_id: string) => app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id }) });
    for (let i = 1; i <= 4; i++) {
      const res = await search(`99999999${i}`);
      assert.match(res.body, new RegExp(`ניסיונות שנותרו: <bdi dir="ltr">${5 - i}</bdi>`), `try ${i}`);
    }
    const ceo = await login({ kind: "staff", email: "chief@aguda.org.il" });
    assert.doesNotMatch((await app.inject({ url: "/manager", cookies: ceo })).body, /alerts\/clear/, "no alert yet");

    const fifth = await search("999999995");
    assert.equal(fifth.headers.location, "/staff/login?error=removed_lookups");
    assert.equal(fifth.cookies.find((c) => c.name === "session")?.value, "", "the session is cleared");
    assert.equal((await pool.query("SELECT 1 FROM staff WHERE email = 'dana@aguda.org.il'")).rowCount, 0);
    assert.equal((await app.inject({ url: "/staff", cookies })).headers.location, "/staff/login?error=not_staff");
    assert.match((await app.inject("/staff/login?error=removed_lookups")).body, /הסרנו אותך מרשימת הצוות/);

    const page = (await app.inject({ url: "/manager", cookies: ceo })).body;
    assert.match(page, /<div class="error"><ul><li>הסרנו מרשימת הצוות את <bdi dir="ltr">dana@aguda\.org\.il<\/bdi> \(עובד\) אחרי 5 חיפושים/);
    assert.doesNotMatch(page, /99999999/, "the typed IDs are not shown");
    assert.doesNotMatch((await app.inject({ url: "/manager", cookies: await asManager() })).body, /alerts\/clear/, "only a ceo sees alerts");
  });

  test("clearing removes only the alerts the ceo saw", async () => {
    await pool.query(`UPDATE settings SET staff_alerts = '[{"at": "2026-10-20T10:00:00+00:00", "email": "a@aguda.org.il", "role": "worker"}, {"at": "2026-10-20T11:00:00+00:00", "email": "b@aguda.org.il", "role": "manager"}]'`);
    const ceo = await login({ kind: "staff", email: "chief@aguda.org.il" });
    const page = (await app.inject({ url: "/manager", cookies: ceo })).body;
    assert.match(page, /name="up_to" value="2026-10-20T11:00:00\+00:00"/);
    // A third alert arrives after the page loaded.
    await pool.query(`UPDATE settings SET staff_alerts = staff_alerts || '[{"at": "2026-10-20T12:00:00+00:00", "email": "c@aguda.org.il", "role": "worker"}]'`);
    const res = await app.inject({ method: "POST", url: "/manager/alerts/clear", cookies: ceo, ...form({ up_to: "2026-10-20T11:00:00+00:00" }) });
    assert.equal(res.headers.location, "/manager");
    const left = (await pool.query("SELECT staff_alerts FROM settings")).rows[0].staff_alerts;
    assert.deepEqual(left.map((a: { email: string }) => a.email), ["c@aguda.org.il"]);
    for (const cookies of [await asManager(), await asStaff()]) {
      assert.equal((await app.inject({ method: "POST", url: "/manager/alerts/clear", cookies, ...form({ up_to: "2030-01-01T00:00:00Z" }) })).statusCode, 403);
    }
    assert.equal((await app.inject({ method: "POST", url: "/manager/alerts/clear", cookies: ceo, ...form({ up_to: "soon" }) })).statusCode, 400);
  });

  test("a found student resets the count; an empty search does not count", async () => {
    const cookies = await asStaff();
    const search = (national_id: string) => app.inject({ method: "POST", url: "/staff/lookup", cookies, ...form({ national_id }) });
    for (let i = 0; i < 4; i++) await search("999");
    await search(ids[0]);
    for (let i = 0; i < 4; i++) await search("999");
    for (let i = 0; i < 3; i++) await search("  ");
    assert.equal((await pool.query("SELECT failed_lookups FROM staff WHERE email = 'dana@aguda.org.il'")).rows[0].failed_lookups, 4);
  });

  test("two wrong searches at the same moment remove the person once, with one alert", async () => {
    await pool.query("UPDATE staff SET failed_lookups = 4 WHERE email = 'dana@aguda.org.il'");
    const { recordLookup } = await import("../src/staff.ts");
    const results = await Promise.all([recordLookup("dana@aguda.org.il", false), recordLookup("dana@aguda.org.il", false)]);
    assert.equal(results.filter((r) => r.removed).length, 1);
    assert.equal((await pool.query("SELECT jsonb_array_length(staff_alerts) AS n FROM settings")).rows[0].n, 1);
  });

  test("the rule removes a manager too, but never a ceo from the fixed list (request 56)", async () => {
    const boss = await asManager();
    for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/staff/lookup", cookies: boss, ...form({ national_id: "999" }) });
    assert.equal((await pool.query("SELECT 1 FROM staff WHERE email = 'boss@aguda.org.il'")).rowCount, 0);
    assert.equal((await pool.query("SELECT staff_alerts FROM settings")).rows[0].staff_alerts[0].role, "manager");

    const ceo = await login({ kind: "staff", email: "chief@aguda.org.il" });
    for (let i = 0; i < 6; i++) await app.inject({ method: "POST", url: "/staff/lookup", cookies: ceo, ...form({ national_id: "999" }) });
    assert.equal((await app.inject({ url: "/staff", cookies: ceo })).statusCode, 200, "the ceo keeps access");
    assert.equal((await pool.query("SELECT jsonb_array_length(staff_alerts) AS n FROM settings")).rows[0].n, 1);
  });

  test("the ceos come from the fixed list: no table row, listed on the page, never added or removed", async () => {
    const ceo = await login({ kind: "staff", email: "Chief@aguda.org.il" });
    const page = (await app.inject({ url: "/manager", cookies: ceo })).body;
    assert.match(page, /chief@aguda\.org\.il<\/bdi><\/td><td>מנכ"ל<\/td>/);
    assert.match(page, /chief2@aguda\.org\.il<\/bdi><\/td><td>מנכ"ל<\/td>/);
    assert.doesNotMatch(page, /<option value="ceo">/);
    const add = await app.inject({ method: "POST", url: "/manager/staff/add", cookies: ceo, ...form({ email: "chief2@aguda.org.il", role: "manager", campus: "" }) });
    assert.equal(add.headers.location, "/manager?error=higher");
    await assert.rejects(pool.query("INSERT INTO staff (email, role) VALUES ('x@aguda.org.il', 'ceo')"), /staff_role_check/);
    // A listed email with an old manager row is still a ceo.
    await pool.query("INSERT INTO staff (email, role) VALUES ('chief2@aguda.org.il', 'manager')");
    const second = await login({ kind: "staff", email: "chief2@aguda.org.il" });
    assert.equal((await app.inject({ url: "/manager/gifts", cookies: second })).statusCode, 200);
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
    const res = await app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email: " New@Mail.HUJI.ac.il ", role: "worker" }) });
    assert.equal(res.headers.location, "/manager?done=added_worker");
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
      ["BOSS@aguda.org.il", "higher"],
    ]) {
      const res = await app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email, role: "worker" }) });
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

  test("a manager adds and removes only workers: never a manager (request 32)", async () => {
    const cookies = await asManager();
    const add = (email: string, role: string) =>
      app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email, role }) });
    assert.equal((await add("second@aguda.org.il", "manager")).headers.location, "/manager?error=forbidden_role");
    assert.equal((await add("dana@aguda.org.il", "manager")).headers.location, "/manager?error=forbidden_role", "no promotion to own level");
    assert.equal((await add("dana@aguda.org.il", "worker")).headers.location, "/manager?error=exists");
    assert.equal((await add("x@aguda.org.il", "admin")).headers.location, "/manager?error=invalid_role");
    assert.equal((await add("x@gmail.com", "worker")).headers.location, "/manager?error=wrong_domain");
    const roles = (await pool.query("SELECT email, role FROM staff ORDER BY email")).rows;
    assert.deepEqual(roles, [{ email: "boss@aguda.org.il", role: "manager" }, { email: "dana@aguda.org.il", role: "worker" }]);
  });

  test("a manager cannot give the ceo role, and sees neither it nor the downloads (request 29)", async () => {
    const cookies = await asManager();
    const res = await app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email: "boss@aguda.org.il", role: "ceo" }) });
    assert.equal(res.headers.location, "/manager?error=forbidden_role");
    assert.equal((await pool.query("SELECT role FROM staff WHERE email = 'boss@aguda.org.il'")).rows[0].role, "manager");
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.doesNotMatch(page, /value="ceo"/);
    assert.doesNotMatch(page, /\/manager\/export\//);
    for (const who of [cookies, await asStaff()]) {
      assert.equal((await app.inject({ url: "/manager/export/students.csv", cookies: who })).statusCode, 403);
    }
  });

  test("a ceo adds managers and promotes workers, but never gives the ceo role", async () => {
    const cookies = await login({ kind: "staff", email: "chief@aguda.org.il" });
    assert.match((await app.inject({ url: "/staff", cookies })).body, /href="\/manager"/);
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.match(page, /<select name="role"><option value="worker">עובד<\/option><option value="manager">מנהל<\/option><\/select>/);
    for (const t of ["students", "gifts", "staff"]) assert.match(page, new RegExp(`href="/manager/export/${t}.csv" download`));

    const add = (email: string, role: string) =>
      app.inject({ method: "POST", url: "/manager/staff/add", cookies, ...form({ email, role, campus: "הר הצופים" }) });
    assert.equal((await add("new@aguda.org.il", "manager")).headers.location, "/manager?done=added_manager");
    assert.equal((await add("dana@aguda.org.il", "manager")).headers.location, "/manager?done=promoted_manager");
    assert.equal((await add("dana@aguda.org.il", "worker")).headers.location, "/manager?error=higher", "never a demotion");
    assert.equal((await add("boss@aguda.org.il", "ceo")).headers.location, "/manager?error=forbidden_role");
    const stock = await app.inject({ method: "POST", url: "/manager/stock", cookies, ...form({ gift_id: "1", campus: "רחובות", starting_inventory: "9" }) });
    assert.equal(stock.headers.location, "/manager?done=stock");
    // The list shows the highest role first.
    assert.match((await app.inject({ url: "/manager", cookies })).body, /chief@aguda\.org\.il.*boss@aguda\.org\.il/s);
  });

  test("a ceo downloads each table as CSV that Excel reads, with no formula injection", async () => {
    await pool.query(`UPDATE students SET first_name = '=HYPERLINK("x")', last_name = 'כהן, "הגדול"' WHERE national_id = $1`, [ids[0]]);
    const cookies = await login({ kind: "staff", email: "chief@aguda.org.il" });

    const res = await app.inject({ url: "/manager/export/students.csv", cookies });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /^text\/csv; charset=utf-8/);
    assert.match(res.headers["content-disposition"] as string, /^attachment; filename="aguda-students-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(res.body.startsWith("\uFEFFnational_id,"), "BOM, then the header row");
    const lines = res.body.trim().split("\r\n");
    assert.equal(lines.length, 1 + 10, "a header and one line per student");
    const row = lines.find((l) => l.startsWith(ids[0]))!;
    assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), "a formula is defused and quoted");
    assert.ok(row.includes(`"כהן, ""הגדול"""`), "commas and quotes are escaped");
    assert.match(row, /"\[""הר הצופים""\]"|"\[""[^"]+""\]"/, "a list is JSON in its cell");

    for (const t of ["gifts", "staff"]) {
      assert.equal((await app.inject({ url: `/manager/export/${t}.csv`, cookies })).statusCode, 200, t);
    }
    assert.equal((await app.inject({ url: "/manager/export/pg_shadow.csv", cookies })).statusCode, 404);
  });

  test("a ceo sees every selection and reverses a handout, after a confirm step (request 40)", async () => {
    const ceo = await login({ kind: "staff", email: "chief@aguda.org.il" });
    await selectGift(ids[0], 2);
    await selectGift(ids[1], 3);
    await markTaken(ids[0]);
    assert.match((await app.inject({ url: "/manager", cookies: ceo })).body, /href="\/manager\/gifts"/);

    const list = (await app.inject({ url: "/manager/gifts", cookies: ceo })).body;
    assert.equal(list.split("<tr><td>").length - 1, 2, "both selections");
    assert.match(list, /נמסרה ב־/);
    assert.match(list, /נבחרה/);
    assert.equal(list.split('action="/manager/gifts/unmark"').length - 1, 1, "a button only for the handout");

    const confirm = await app.inject({ method: "POST", url: "/manager/gifts/unmark", cookies: ceo, ...form({ national_id: ids[0] }) });
    assert.match(confirm.body, /ביטול מסירה/);
    assert.ok((await student(ids[0])).gift_taken_at, "the confirm page changes nothing");

    const done = await app.inject({ method: "POST", url: "/manager/gifts/unmark", cookies: ceo, ...form({ national_id: ids[0], confirm: "1" }) });
    assert.equal(done.headers.location, "/manager/gifts?done=unmarked");
    const s = await student(ids[0]);
    assert.equal(s.gift_taken_at, null);
    assert.equal(s.gift_id, 2, "the selection stays");
    assert.deepEqual(s.interactions.map((i: { type: string }) => i.type), ["gift_collection", "gift_collection_reversed"]);
    assert.equal((await gift(2)).given_count, 0);
    assert.equal((await gift(2)).requested_count, 1);
    assert.deepEqual(await counterDrift(), []);

    // A second reversal does nothing; the desk can hand the gift over again.
    const again = await app.inject({ method: "POST", url: "/manager/gifts/unmark", cookies: ceo, ...form({ national_id: ids[0], confirm: "1" }) });
    assert.equal(again.headers.location, "/manager/gifts?error=not_taken");
    assert.equal((await gift(2)).given_count, 0);
    const card = await app.inject({ method: "POST", url: "/staff/lookup", cookies: await asStaff(), ...form({ national_id: ids[0] }) });
    assert.match(card.body, /ביטול מסירה:/);
    assert.match(card.body, /action="\/staff\/take"/);
    assert.equal((await markTaken(ids[0])).ok, true);
    assert.equal((await gift(2)).given_count, 1);
  });

  test("a ceo deletes a selection not handed over, after a confirm step (request 50)", async () => {
    const ceo = await login({ kind: "staff", email: "chief@aguda.org.il" });
    await selectGift(ids[0], 2);
    await selectGift(ids[1], 3);
    await markTaken(ids[1]);
    const list = (await app.inject({ url: "/manager/gifts", cookies: ceo })).body;
    assert.equal(list.split('action="/manager/gifts/remove"').length - 1, 1, "only the row not handed over");

    const confirm = await app.inject({ method: "POST", url: "/manager/gifts/remove", cookies: ceo, ...form({ national_id: ids[0] }) });
    assert.match(confirm.body, /אישור מחיקה/);
    assert.match(confirm.body, /action="\/manager\/gifts\/remove"/);
    assert.match(confirm.body, /href="\/manager\/gifts"/);
    assert.equal((await student(ids[0])).gift_id, 2, "the confirm page changes nothing");

    const done = await app.inject({ method: "POST", url: "/manager/gifts/remove", cookies: ceo, ...form({ national_id: ids[0], confirm: "1" }) });
    assert.equal(done.headers.location, "/manager/gifts?done=removed");
    assert.equal((await student(ids[0])).gift_id, null);
    assert.ok((await student(ids[0])).survey, "the survey stays");
    assert.equal((await gift(2)).requested_count, 0);

    const handedOver = await app.inject({ method: "POST", url: "/manager/gifts/remove", cookies: ceo, ...form({ national_id: ids[1], confirm: "1" }) });
    assert.equal(handedOver.headers.location, "/manager/gifts?error=taken");
    assert.equal((await student(ids[1])).gift_id, 3);
    assert.deepEqual(await counterDrift(), []);
    for (const cookies of [await asManager(), await asStaff()]) {
      assert.equal((await app.inject({ method: "POST", url: "/manager/gifts/remove", cookies, ...form({ national_id: ids[1], confirm: "1" }) })).statusCode, 403);
    }
  });

  test("only a ceo sees the selections or reverses a handout", async () => {
    await selectGift(ids[0], 2);
    await markTaken(ids[0]);
    for (const cookies of [await asManager(), await asStaff()]) {
      assert.equal((await app.inject({ url: "/manager/gifts", cookies })).statusCode, 403);
      const res = await app.inject({ method: "POST", url: "/manager/gifts/unmark", cookies, ...form({ national_id: ids[0], confirm: "1" }) });
      assert.equal(res.statusCode, 403);
    }
    assert.ok((await student(ids[0])).gift_taken_at);
    assert.doesNotMatch((await app.inject({ url: "/manager", cookies: await asManager() })).body, /href="\/manager\/gifts"/);
  });

  test("the database refuses a role other than worker or manager", async () => {
    await assert.rejects(pool.query("INSERT INTO staff (email, role) VALUES ('x@aguda.org.il', 'admin')"), /staff_role_check/);
  });

  test("a manager's add form offers only the worker role", async () => {
    const res = await app.inject({ url: "/manager", cookies: await asManager() });
    assert.match(res.body, /<select name="role"><option value="worker">עובד<\/option><\/select>/);
  });

  test("a manager cannot remove a manager or a ceo, and sees no button for them", async () => {
    await pool.query("INSERT INTO staff (email, role, campus) VALUES ('other@aguda.org.il', 'manager', 'הר הצופים')");
    const cookies = await asManager();
    for (const email of ["other@aguda.org.il", "chief@aguda.org.il"]) {
      const res = await app.inject({ method: "POST", url: "/manager/staff/remove", cookies, ...form({ email }) });
      assert.equal(res.headers.location, "/manager?error=remove_forbidden", email);
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM staff")).rows[0].n, 3, "the ceos are not rows");
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.equal(page.split('action="/manager/staff/remove"').length - 1, 1, "a button only for the worker");
    assert.match(page, /רק אנשי צוות בתפקיד נמוך מהתפקיד שלו/);
  });

  test("a ceo removes managers and workers, but never a ceo (request 32)", async () => {
    const cookies = await login({ kind: "staff", email: "chief@aguda.org.il" });
    const boss = await asManager();
    const page = (await app.inject({ url: "/manager", cookies })).body;
    assert.equal(page.split('action="/manager/staff/remove"').length - 1, 2, "boss and dana; no ceo");

    const remove = (email: string) => app.inject({ method: "POST", url: "/manager/staff/remove", cookies, ...form({ email }) });
    assert.equal((await remove("boss@aguda.org.il")).headers.location, "/manager?done=removed");
    assert.equal((await remove("chief2@aguda.org.il")).headers.location, "/manager?error=remove_forbidden");
    assert.equal((await remove("Chief@aguda.org.il")).headers.location, "/manager?error=remove_self");
    assert.equal((await remove("nobody@aguda.org.il")).headers.location, "/manager?error=not_found");
    const left = (await pool.query("SELECT email FROM staff ORDER BY email")).rows.map((r) => r.email);
    assert.deepEqual(left, ["dana@aguda.org.il"], "boss removed; the ceos are not rows");
    assert.equal((await app.inject({ url: "/staff", cookies: boss })).headers.location, "/staff/login?error=not_staff", "a removed manager is locked out at once");
  });

  test("a manager removes a worker, and the worker is locked out at once", async () => {
    const worker = await asStaff();
    const res = await app.inject({ method: "POST", url: "/manager/staff/remove", cookies: await asManager(), ...form({ email: "dana@aguda.org.il" }) });
    assert.equal(res.headers.location, "/manager?done=removed");
    assert.deepEqual(await workers(), []);
    assert.equal((await app.inject({ url: "/staff", cookies: worker })).headers.location, "/staff/login?error=not_staff");
  });

  test("the manager page lists all the staff with their roles, and each gift's stock", async () => {
    const res = await app.inject({ url: "/manager", cookies: await asManager() });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /boss@aguda\.org\.il<\/bdi><\/td><td>מנהל<\/td><td>הר הצופים<\/td><td><\/td>/, "a manager has no remove button");
    assert.match(res.body, /dana@aguda\.org\.il<\/bdi><\/td><td>עובד<\/td><td>הר הצופים<\/td><td><form[^>]*staff\/remove/);
    assert.equal(res.body.split('action="/manager/stock"').length - 1, 4);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("a worker cannot use any manager route, and nothing changes", async () => {
    const cookies = await asStaff();
    for (const [url, body] of [
      ["/manager/staff/add", { email: "x@aguda.org.il", role: "manager" }],
      ["/manager/staff/remove", { email: "dana@aguda.org.il" }],
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
