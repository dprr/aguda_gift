import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { type Claims, decide, type GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { buildApp } from "../src/server.ts";
import { freshDatabase, loadStudents, student } from "./helpers.ts";

after(() => pool.end());

const domains = { student: ["mail.huji.ac.il"], staff: ["aguda.org"] };

// ---- the pure decision (plan §2) ------------------------------------------------------

describe("decide", () => {
  const cases: [string, Claims, string][] = [
    ["HUJI → student", { email: "a@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, "student"],
    ["Aguda → staff", { email: "b@aguda.org", email_verified: true, hd: "aguda.org" }, "staff"],
    ["personal Gmail has no hd → refused", { email: "c@gmail.com", email_verified: true }, "no_domain"],
    ["empty hd → refused", { email: "c@x.com", email_verified: true, hd: "" }, "no_domain"],
    ["other organization → refused", { email: "d@tau.ac.il", email_verified: true, hd: "tau.ac.il" }, "wrong_domain"],
    ["unverified email → refused", { email: "a@mail.huji.ac.il", email_verified: false, hd: "mail.huji.ac.il" }, "unverified_email"],
    ["missing email → refused", { email_verified: true, hd: "mail.huji.ac.il" }, "unverified_email"],
    ["upper-case hd still matches", { email: "a@mail.huji.ac.il", email_verified: true, hd: "MAIL.HUJI.AC.IL" }, "student"],
    // The email's own domain is not trusted. Only hd, which Google sets from the account.
    ["huji-looking email without hd → refused", { email: "x@mail.huji.ac.il", email_verified: true }, "no_domain"],
  ];
  for (const [name, claims, expected] of cases) {
    test(name, () => {
      const d = decide(claims, domains);
      assert.equal(d.kind === "refused" ? d.reason : d.kind, expected);
    });
  }

  test("the email is lowercased", () => {
    const d = decide({ email: "Dana@Mail.HUJI.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, domains);
    assert.deepEqual(d, { kind: "student", email: "dana@mail.huji.ac.il" });
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

async function app(result: Claims | Error, extra: { devLogin?: boolean; authRateLimit?: number } = {}) {
  const { google, seen } = stubGoogle(result);
  const a = await buildApp({
    google,
    sessionSecret: "test-secret-test-secret-test-secret",
    domains,
    devLogin: extra.devLogin ?? false,
    production: false,
    origin: "http://localhost:3000",
    authRateLimit: extra.authRateLimit,
  });
  return { app: a, seen };
}

type App = Awaited<ReturnType<typeof buildApp>>;

/** Run /auth/google then /auth/callback, as a browser would. */
async function googleFlow(a: App, tweak: { state?: string; noCookie?: boolean; query?: string } = {}) {
  const start = await a.inject({ method: "GET", url: "/auth/google" });
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

describe("login flow", () => {
  let ids: string[];
  beforeEach(async () => {
    await freshDatabase();
    ids = await loadStudents(3, 2);
  });

  test("the login page shows one Google button, and no dev form unless enabled", async () => {
    const { app: a } = await app({});
    const res = await a.inject("/");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /href="\/auth\/google"/);
    assert.match(res.body, /dir="rtl"/);
    assert.doesNotMatch(res.body, /\/auth\/dev/);
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

  test("an Aguda account gets a staff session", async () => {
    const { app: a } = await app({ email: "dana@aguda.org", email_verified: true, hd: "aguda.org" });
    const res = await googleFlow(a);
    assert.equal(res.headers.location, "/staff");
    const page = await a.inject({ url: "/staff", cookies: { session: sessionOf(res)! } });
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes("dana@aguda.org"));
  });

  for (const [name, claims, reason] of [
    ["personal Gmail", { email: "x@gmail.com", email_verified: true }, "no_domain"],
    ["another university", { email: "x@tau.ac.il", email_verified: true, hd: "tau.ac.il" }, "wrong_domain"],
    ["a HUJI account not in the list", { email: "nobody@mail.huji.ac.il", email_verified: true, hd: "mail.huji.ac.il" }, "not_in_list"],
  ] as const) {
    test(`${name} is refused with no session`, async () => {
      const { app: a } = await app(claims);
      const res = await googleFlow(a);
      assert.equal(res.headers.location, `/?error=${reason}`);
      assert.equal(sessionOf(res), undefined);
    });
  }

  test("a wrong state, or a missing state cookie, is refused", async () => {
    const claims = { email: "dana@aguda.org", email_verified: true, hd: "aguda.org" };
    for (const tweak of [{ state: "forged" }, { noCookie: true }]) {
      const { app: a } = await app(claims);
      const res = await googleFlow(a, tweak);
      assert.equal(res.headers.location, "/?error=expired");
      assert.equal(sessionOf(res), undefined);
    }
  });

  test("a cancelled login and a Google failure are explained", async () => {
    let { app: a } = await app({});
    assert.equal((await googleFlow(a, { query: "error=access_denied" })).headers.location, "/?error=cancelled");
    ({ app: a } = await app(new Error("token exchange failed")));
    assert.equal((await googleFlow(a)).headers.location, "/?error=google_error");
  });

  test("a student session cannot open the staff page, and the reverse (403)", async () => {
    const s = await student(ids[0]);
    const { app: studentApp } = await app({ email: s.university_email, email_verified: true, hd: "mail.huji.ac.il" });
    const studentCookie = sessionOf(await googleFlow(studentApp))!;
    assert.equal((await studentApp.inject({ url: "/staff", cookies: { session: studentCookie } })).statusCode, 403);

    const { app: staffApp } = await app({ email: "dana@aguda.org", email_verified: true, hd: "aguda.org" });
    const staffCookie = sessionOf(await googleFlow(staffApp))!;
    assert.equal((await staffApp.inject({ url: "/student", cookies: { session: staffCookie } })).statusCode, 403);
  });

  test("no session redirects to the login page", async () => {
    const { app: a } = await app({});
    for (const url of ["/student", "/staff"]) {
      const res = await a.inject(url);
      assert.equal(res.headers.location, "/");
    }
  });

  test("a hand-written or tampered session cookie is ignored", async () => {
    const { app: a } = await app({ email: "dana@aguda.org", email_verified: true, hd: "aguda.org" });
    const forged = JSON.stringify({ kind: "staff", email: "attacker@aguda.org" });
    assert.equal((await a.inject({ url: "/staff", cookies: { session: forged } })).headers.location, "/");

    const real = sessionOf(await googleFlow(a))!;
    const tampered = real.replace("dana", "evil");
    assert.equal((await a.inject({ url: "/staff", cookies: { session: tampered } })).headers.location, "/");
  });

  test("logout clears the session", async () => {
    const { app: a } = await app({ email: "dana@aguda.org", email_verified: true, hd: "aguda.org" });
    await googleFlow(a);
    const res = await a.inject({ method: "POST", url: "/auth/logout" });
    const cleared = res.cookies.find((c) => c.name === "session")!;
    assert.equal(cleared.value, "");
  });

  test("the login routes are rate-limited per IP", async () => {
    const { app: a } = await app({}, { authRateLimit: 5 });
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await a.inject("/auth/google")).statusCode);
    assert.deepEqual(codes, [302, 302, 302, 302, 302, 429, 429]);
  });

  test("the development login works only when enabled", async () => {
    const { app: off } = await app({});
    assert.equal((await off.inject({ method: "POST", url: "/auth/dev" })).statusCode, 404);

    const { app: on } = await app({}, { devLogin: true });
    assert.match((await on.inject("/")).body, /\/auth\/dev/);
    const res = await on.inject({
      method: "POST",
      url: "/auth/dev",
      payload: `kind=student&national_id=${ids[0]}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(res.headers.location, "/student");
  });

  test("the development login refuses to start in production", async () => {
    const { google } = stubGoogle({});
    await assert.rejects(
      buildApp({ google, sessionSecret: "x".repeat(32), domains, devLogin: true, production: true, origin: "https://gifts.aguda.org" }),
      /DEV_LOGIN must be off in production/,
    );
  });
});
