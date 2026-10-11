import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { type Claims, decide, type GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { buildApp } from "../src/server.ts";
import { freshDatabase, loadStudents, student } from "./helpers.ts";

after(() => pool.end());

const domains = { student: ["mail.huji.ac.il"], staff: ["mail.huji.ac.il", "aguda.org.il"] };
const managers = ["boss@aguda.org.il"];

// ---- the pure decision (plan §2) ------------------------------------------------------

describe("decide", () => {
  const cases: [string, Claims, string[], string][] = [
    ["HUJI on the student page → ok", { email: "a@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, domains.student, "ok"],
    ["Aguda on the staff page → ok", { email: "b@aguda.org.il", email_verified: true, hd: "aguda.org.il" }, domains.staff, "ok"],
    ["HUJI on the staff page → ok", { email: "a@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, domains.staff, "ok"],
    ["Aguda on the student page → refused", { email: "b@aguda.org.il", email_verified: true, hd: "aguda.org.il" }, domains.student, "wrong_domain"],
    ["personal Gmail has no hd → refused", { email: "c@gmail.com", email_verified: true }, domains.staff, "no_domain"],
    ["empty hd → refused", { email: "c@x.com", email_verified: true, hd: "" }, domains.staff, "no_domain"],
    ["other organization → refused", { email: "d@tau.ac.il", email_verified: true, hd: "tau.ac.il" }, domains.staff, "wrong_domain"],
    ["the old domain aguda.org → refused", { email: "b@aguda.org", email_verified: true, hd: "aguda.org" }, domains.staff, "wrong_domain"],
    ["unverified email → refused", { email: "a@mail.huji.ac.il", email_verified: false, hd: "mail.huji.ac.il" }, domains.student, "unverified_email"],
    ["missing email → refused", { email_verified: true, hd: "mail.huji.ac.il" }, domains.student, "unverified_email"],
    ["upper-case hd still matches", { email: "a@mail.huji.ac.il", email_verified: true, hd: "MAIL.HUJI.AC.IL" }, domains.student, "ok"],
    // The email's own domain is not trusted. Only hd, which Google sets from the account.
    ["huji-looking email without hd → refused", { email: "x@mail.huji.ac.il", email_verified: true }, domains.student, "no_domain"],
  ];
  for (const [name, claims, allowed, expected] of cases) {
    test(name, () => {
      const d = decide(claims, allowed);
      assert.equal(d.kind === "refused" ? d.reason : d.kind, expected);
    });
  }

  test("the email is lowercased", () => {
    const d = decide({ email: "Dana@Mail.HUJI.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, domains.student);
    assert.deepEqual(d, { kind: "ok", email: "dana@mail.huji.ac.il" });
  });
});

// ---- the HTTP flow --------------------------------------------------------------------

/** A Google that returns fixed claims. Records the PKCE verifier it receives. */
function stubGoogle(result: Claims | Error) {
  const seen: { verifier?: string } = {};
  const google: GoogleLogin = {
    async start(state) {
      return { url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`, codeVerifier: "pkce-verifier" };
    },
    async finish(_code, verifier) {
      seen.verifier = verifier;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { google, seen };
}

async function app(result: Claims | Error, extra: { devLogin?: boolean } = {}) {
  const { google, seen } = stubGoogle(result);
  const a = await buildApp({
    google,
    sessionSecret: "test-secret-test-secret-test-secret",
    domains,
    managers,
    devLogin: extra.devLogin ?? false,
    production: false,
    origin: "http://localhost:3000",
  });
  return { app: a, seen };
}

type App = Awaited<ReturnType<typeof buildApp>>;

/** Run /auth/google (or /auth/google/staff) then /auth/callback, as a browser would. */
async function googleFlow(
  a: App,
  tweak: { door?: "staff"; state?: string; noCookie?: boolean; query?: string } = {},
) {
  const start = await a.inject({ method: "GET", url: tweak.door === "staff" ? "/auth/google/staff" : "/auth/google" });
  const state = new URL(start.headers.location as string).searchParams.get("state")!;
  const oauth = start.cookies.find((c) => c.name === "oauth")!.value;
  const query = tweak.query ?? `code=abc&state=${encodeURIComponent(tweak.state ?? state)}`;
  return a.inject({
    method: "GET",
    url: `/auth/callback?${query}`,
    cookies: tweak.noCookie ? {} : { oauth },
  });
}

const sessionOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === "session" && c.value)?.value;

const boss = { email: "boss@aguda.org.il", email_verified: true, hd: "aguda.org.il" };
const addWorker = (email: string) => pool.query("INSERT INTO workers (email) VALUES ($1)", [email]);

describe("login flow", () => {
  let ids: string[];
  beforeEach(async () => {
    await freshDatabase();
    ids = await loadStudents(3, 2);
  });

  test("the student login page is the default, and links to the staff login page", async () => {
    const { app: a } = await app({});
    const res = await a.inject("/");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /href="\/auth\/google"/);
    assert.match(res.body, /href="\/staff\/login"/);
    assert.match(res.body, /dir="rtl"/);
    assert.doesNotMatch(res.body, /\/auth\/dev/);

    const staff = await a.inject("/staff/login");
    assert.equal(staff.statusCode, 200);
    assert.match(staff.body, /href="\/auth\/google\/staff"/);
    assert.match(staff.body, /href="\/"/);
  });

  test("/auth/google sends the browser to Google with a state, and asks to pick an account", async () => {
    const { app: a } = await app({});
    const res = await a.inject("/auth/google");
    assert.equal(res.statusCode, 302);
    assert.match(res.headers.location as string, /^https:\/\/accounts\.google\.com\//);
    const oauth = res.cookies.find((c) => c.name === "oauth")!;
    assert.equal(oauth.httpOnly, true);
    assert.equal(oauth.sameSite, "Lax");
  });

  test("a HUJI student in the list gets a student session", async () => {
    const s = await student(ids[0]);
    const { app: a, seen } = await app({ email: s.university_email.toUpperCase(), email_verified: true, hd: "mail.huji.ac.il" });

    const res = await googleFlow(a);

    assert.equal(res.headers.location, "/student");
    assert.equal(seen.verifier, "pkce-verifier");
    const page = await a.inject({ url: "/student", cookies: { session: sessionOf(res)! } });
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes(s.first_name));
  });

  test("a manager from MANAGERS gets a staff session with the manager link", async () => {
    const { app: a } = await app(boss);
    const res = await googleFlow(a, { door: "staff" });
    assert.equal(res.headers.location, "/staff");
    const page = await a.inject({ url: "/staff", cookies: { session: sessionOf(res)! } });
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes("boss@aguda.org.il"));
    assert.match(page.body, /href="\/manager"/);
  });

  test("a worker with a HUJI account gets a staff session, with no manager link", async () => {
    await addWorker("dana@mail.huji.ac.il");
    const { app: a } = await app({ email: "Dana@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" });
    const res = await googleFlow(a, { door: "staff" });
    assert.equal(res.headers.location, "/staff");
    const cookies = { session: sessionOf(res)! };
    const page = await a.inject({ url: "/staff", cookies });
    assert.equal(page.statusCode, 200);
    assert.doesNotMatch(page.body, /href="\/manager"/);
    assert.equal((await a.inject({ url: "/manager", cookies })).statusCode, 403);
  });

  test("a student who is also a worker picks the session by the login page", async () => {
    const s = await student(ids[0]);
    await addWorker(s.university_email);
    const { app: a } = await app({ email: s.university_email, email_verified: true, hd: "mail.huji.ac.il" });
    assert.equal((await googleFlow(a)).headers.location, "/student");
    assert.equal((await googleFlow(a, { door: "staff" })).headers.location, "/staff");
  });

  for (const [name, door, claims, location] of [
    ["personal Gmail", undefined, { email: "x@gmail.com", email_verified: true }, "/?error=no_domain"],
    ["another university", undefined, { email: "x@tau.ac.il", email_verified: true, hd: "tau.ac.il" }, "/?error=wrong_domain"],
    ["a HUJI account not in the list", undefined, { email: "nobody@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, "/?error=not_in_list"],
    ["an Aguda account on the student page", undefined, boss, "/?error=wrong_domain"],
    ["an Aguda account not on the staff list", "staff", { email: "dana@aguda.org.il", email_verified: true, hd: "aguda.org.il" }, "/staff/login?error=not_staff"],
    ["a HUJI student on the staff page", "staff", { email: "nobody@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, "/staff/login?error=not_staff"],
    ["personal Gmail on the staff page", "staff", { email: "boss@gmail.com", email_verified: true }, "/staff/login?error=no_domain"],
  ] as const) {
    test(`${name} is refused with no session`, async () => {
      const { app: a } = await app(claims);
      const res = await googleFlow(a, { door });
      assert.equal(res.headers.location, location);
      assert.equal(sessionOf(res), undefined);
      const page = await a.inject(location);
      assert.match(page.body, /class="error"/, "the login page explains the refusal");
    });
  }

  test("a wrong state, or a missing state cookie, is refused", async () => {
    for (const tweak of [{ state: "forged" }, { noCookie: true }]) {
      const { app: a } = await app(boss);
      const res = await googleFlow(a, tweak);
      assert.equal(res.headers.location, "/?error=expired");
      assert.equal(sessionOf(res), undefined);
    }
    const { app: a } = await app(boss);
    assert.equal((await googleFlow(a, { door: "staff", state: "forged" })).headers.location, "/staff/login?error=expired");
  });

  test("a cancelled login and a Google failure are explained", async () => {
    let { app: a } = await app({});
    assert.equal((await googleFlow(a, { query: "error=access_denied" })).headers.location, "/?error=cancelled");
    assert.equal((await googleFlow(a, { door: "staff", query: "error=access_denied" })).headers.location, "/staff/login?error=cancelled");
    ({ app: a } = await app(new Error("token exchange failed")));
    assert.equal((await googleFlow(a)).headers.location, "/?error=google_error");
  });

  test("a student session cannot open the staff pages, and the reverse (403)", async () => {
    const s = await student(ids[0]);
    const { app: studentApp } = await app({ email: s.university_email, email_verified: true, hd: "mail.huji.ac.il" });
    const studentCookie = { session: sessionOf(await googleFlow(studentApp))! };
    assert.equal((await studentApp.inject({ url: "/staff", cookies: studentCookie })).statusCode, 403);
    assert.equal((await studentApp.inject({ url: "/manager", cookies: studentCookie })).statusCode, 403);

    const { app: staffApp } = await app(boss);
    const staffCookie = sessionOf(await googleFlow(staffApp, { door: "staff" }))!;
    assert.equal((await staffApp.inject({ url: "/student", cookies: { session: staffCookie } })).statusCode, 403);
  });

  test("no session redirects to the matching login page", async () => {
    const { app: a } = await app({});
    assert.equal((await a.inject("/student")).headers.location, "/");
    assert.equal((await a.inject("/staff")).headers.location, "/staff/login");
    assert.equal((await a.inject("/manager")).headers.location, "/staff/login");
  });

  test("a hand-written or tampered session cookie is ignored", async () => {
    const { app: a } = await app(boss);
    const forged = JSON.stringify({ kind: "staff", email: "boss@aguda.org.il" });
    assert.equal((await a.inject({ url: "/staff", cookies: { session: forged } })).headers.location, "/staff/login");

    const real = sessionOf(await googleFlow(a, { door: "staff" }))!;
    const tampered = real.replace("boss", "evil");
    assert.equal((await a.inject({ url: "/staff", cookies: { session: tampered } })).headers.location, "/staff/login");
  });

  test("a removed worker loses access on the next request, not at cookie expiry", async () => {
    await addWorker("dana@aguda.org.il");
    const { app: a } = await app({ email: "dana@aguda.org.il", email_verified: true, hd: "aguda.org.il" });
    const cookies = { session: sessionOf(await googleFlow(a, { door: "staff" }))! };
    assert.equal((await a.inject({ url: "/staff", cookies })).statusCode, 200);

    await pool.query("DELETE FROM workers");
    const res = await a.inject({ url: "/staff", cookies });
    assert.equal(res.headers.location, "/staff/login?error=not_staff");
    assert.equal(res.cookies.find((c) => c.name === "session")?.value, "", "the session is cleared");
  });

  test("logout clears the session and returns to the matching login page", async () => {
    const { app: a } = await app(boss);
    const session = sessionOf(await googleFlow(a, { door: "staff" }))!;
    const res = await a.inject({ method: "POST", url: "/auth/logout", cookies: { session } });
    assert.equal(res.cookies.find((c) => c.name === "session")!.value, "");
    assert.equal(res.headers.location, "/staff/login");
    assert.equal((await a.inject({ method: "POST", url: "/auth/logout" })).headers.location, "/");
  });

  test("the development login works only when enabled, and keeps the staff list", async () => {
    const { app: off } = await app({});
    assert.equal((await off.inject({ method: "POST", url: "/auth/dev" })).statusCode, 404);

    const { app: on } = await app({}, { devLogin: true });
    assert.match((await on.inject("/")).body, /name="national_id"/);
    assert.match((await on.inject("/staff/login")).body, /name="email"/);
    const dev = (payload: string) =>
      on.inject({ method: "POST", url: "/auth/dev", payload, headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal((await dev(`kind=student&national_id=${ids[0]}`)).headers.location, "/student");
    assert.equal((await dev("kind=staff&email=boss@aguda.org.il")).headers.location, "/staff");
    assert.equal((await dev("kind=staff&email=stranger@aguda.org.il")).headers.location, "/staff/login?error=not_staff");
  });

  test("the development login refuses to start in production", async () => {
    const { google } = stubGoogle({});
    await assert.rejects(
      buildApp({ google, sessionSecret: "x".repeat(32), domains, devLogin: true, production: true, origin: "https://gifts.aguda.org.il" }),
      /DEV_LOGIN must be off in production/,
    );
  });
});

describe("demo mode", () => {
  const demoApp = (demo: boolean, production: boolean) =>
    buildApp({
      google: stubGoogle({}).google,
      sessionSecret: "x".repeat(32),
      domains,
      devLogin: true,
      production,
      demo,
      origin: "https://aguda.felber.eu.org",
    });

  test("production refuses the development login, unless DEMO is set", async () => {
    await assert.rejects(demoApp(false, true), /DEV_LOGIN must be off in production/);
    await demoApp(true, true); // does not throw
  });

  test("demo mode puts the banner on every page; normal mode never does", async () => {
    const demo = await demoApp(true, false);
    const page = await demo.inject("/");
    assert.match(page.body, /<body><div role="alert"[^>]*>גרסת הדגמה/);

    const normal = await demoApp(false, false);
    assert.doesNotMatch((await normal.inject("/")).body, /גרסת הדגמה/);
  });

  test("the banner does not touch responses that are not HTML", async () => {
    const demo = await demoApp(true, false);
    const redirect = await demo.inject("/student");
    assert.doesNotMatch(redirect.body, /גרסת הדגמה/);
  });
});
