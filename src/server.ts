import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { decide, type Domains, findStudentByEmail, type GoogleLogin, googleLogin } from "./auth.ts";
import { pool } from "./db.ts";
import { markTaken, selectGift } from "./gifts.ts";
import { confirmPage, demoBanner, esc, lapsedText, loginPage, type Notice, type RefusalReason, staffPage, type StudentError, studentPage, T, when } from "./pages.ts";
import { findStudent, listGifts, staffStats } from "./queries.ts";
import { startSyncSchedule } from "./schedule.ts";
import { FakeSource, fakeStudents, type StudentSource } from "./source.ts";

export type Session = { kind: "student"; nationalId: string } | { kind: "staff"; email: string };

export type AppOptions = {
  google: GoogleLogin;
  sessionSecret: string;
  domains: Domains;
  devLogin: boolean;
  production: boolean;
  /**
   * A public demonstration with invented data. Allows the development login and the fake
   * source in production, and puts a banner on every page. Never set it with real data.
   */
  demo?: boolean;
  /** This site's origin, for example http://localhost:3000. A POST from any other is refused. */
  origin: string;
};

const SESSION_COOKIE = "session";
const OAUTH_COOKIE = "oauth";
const SESSION_HOURS = 12; // one desk shift

export async function buildApp(options: AppOptions) {
  if (options.production && options.devLogin && !options.demo) {
    throw new Error("DEV_LOGIN must be off in production");
  }

  const app = Fastify({
    logger: options.production
      ? { redact: ["req.headers.cookie", "body.national_id", "national_id"] }
      : false,
  });
  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(formbody);

  // CSRF. The session cookie is SameSite=Lax, so a browser does not send it with a POST
  // from another site. This also refuses a POST whose Origin header names another site,
  // which covers sibling subdomains that SameSite treats as the same site.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST") return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== options.origin) {
      return reply.code(403).send("Forbidden");
    }
  });

  // The demo banner goes into every HTML page, so no page can be mistaken for the real site.
  if (options.demo) {
    app.addHook("onSend", async (_request, reply, payload) => {
      const type = String(reply.getHeader("content-type") ?? "");
      if (!type.startsWith("text/html") || typeof payload !== "string") return payload;
      return payload.replace("<body>", `<body>${demoBanner}`);
    });
  }

  // Pages that show a student must not stay in a shared desk computer's cache.
  const noStore = (reply: FastifyReply) => reply.header("cache-control", "no-store");

  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.production,
    path: "/",
    signed: true,
  };

  function setSession(reply: FastifyReply, session: Session) {
    reply.setCookie(SESSION_COOKIE, JSON.stringify(session), {
      ...cookieBase,
      maxAge: SESSION_HOURS * 3600,
    });
  }

  /** The session from a valid signed cookie, or null. A tampered cookie is null. */
  function readSession(request: FastifyRequest): Session | null {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const { valid, value } = request.unsignCookie(raw);
    if (!valid || !value) return null;
    try {
      return JSON.parse(value) as Session;
    } catch {
      return null;
    }
  }

  const refuse = (reply: FastifyReply, reason: RefusalReason) =>
    reply.redirect(`/?error=${reason}`);

  // ---- the one login page -------------------------------------------------------------

  app.get<{ Querystring: { error?: string } }>("/", async (request, reply) => {
    const session = readSession(request);
    if (session) return reply.redirect(session.kind === "student" ? "/student" : "/staff");
    const error = request.query.error;
    const known = error && error in T.refused ? (error as RefusalReason) : undefined;
    return reply.type("text/html").send(loginPage({ devLogin: options.devLogin, error: known }));
  });

  // ---- Google -------------------------------------------------------------------------

  app.get("/auth/google", async (_request, reply) => {
    const state = randomBytes(16).toString("base64url");
    const { url, codeVerifier } = await options.google.start(state);
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier }), {
      ...cookieBase,
      maxAge: 600,
    });
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      const raw = request.cookies[OAUTH_COOKIE];
      reply.clearCookie(OAUTH_COOKIE, { path: "/" });

      if (request.query.error) {
        return refuse(reply, request.query.error === "access_denied" ? "cancelled" : "google_error");
      }

      // The state must match the one this browser started with. This stops a login that
      // another site started on the student's behalf.
      const unsigned = raw ? request.unsignCookie(raw) : { valid: false, value: null };
      let saved: { state: string; codeVerifier: string } | null = null;
      try {
        saved = unsigned.valid && unsigned.value ? JSON.parse(unsigned.value) : null;
      } catch {
        saved = null;
      }
      if (!saved || !request.query.state || saved.state !== request.query.state || !request.query.code) {
        return refuse(reply, "expired");
      }

      let claims;
      try {
        claims = await options.google.finish(request.query.code, saved.codeVerifier);
      } catch (error) {
        request.log.warn({ err: error }, "Google token exchange failed");
        return refuse(reply, "google_error");
      }

      const decision = decide(claims, options.domains);
      if (decision.kind === "refused") return refuse(reply, decision.reason);

      if (decision.kind === "staff") {
        setSession(reply, { kind: "staff", email: decision.email });
        return reply.redirect("/staff");
      }

      const nationalId = await findStudentByEmail(decision.email);
      if (!nationalId) return refuse(reply, "not_in_list");
      setSession(reply, { kind: "student", nationalId });
      return reply.redirect("/student");
    },
  );

  // ---- development login. Never registered in production ------------------------------

  if (options.devLogin) {
    app.post<{ Body: { kind?: string; national_id?: string; email?: string } }>(
      "/auth/dev",
      async (request, reply) => {
        const { kind, national_id, email } = request.body ?? {};
        if (kind === "student" && national_id) {
          const r = await pool.query("SELECT 1 FROM students WHERE national_id = $1", [
            national_id.trim(),
          ]);
          if (r.rowCount === 0) return refuse(reply, "not_in_list");
          setSession(reply, { kind: "student", nationalId: national_id.trim() });
          return reply.redirect("/student");
        }
        const domain = email?.trim().toLowerCase().split("@")[1];
        if (kind === "staff" && domain && options.domains.staff.includes(domain)) {
          setSession(reply, { kind: "staff", email: email!.trim().toLowerCase() });
          return reply.redirect("/staff");
        }
        return refuse(reply, "wrong_domain");
      },
    );
  }

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/");
  });

  // ---- the two interfaces ------------------------------------------------------------

  /** Plan §6: a student route refuses a staff session, and the reverse. 403, not 404. */
  function requireKind(kind: Session["kind"]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const session = readSession(request);
      if (!session) return reply.redirect("/");
      if (session.kind !== kind) return reply.code(403).send("Forbidden");
      (request as FastifyRequest & { session: Session }).session = session;
    };
  }
  const sessionOf = (request: FastifyRequest) => (request as FastifyRequest & { session: Session }).session;
  const studentId = (request: FastifyRequest) => {
    const s = sessionOf(request);
    return s.kind === "student" ? s.nationalId : "";
  };
  const staffEmail = (request: FastifyRequest) => {
    const s = sessionOf(request);
    return s.kind === "staff" ? s.email : "";
  };
  const html = (reply: FastifyReply, body: string) => noStore(reply).type("text/html").send(body);

  // ---- student ------------------------------------------------------------------------
  // Every student route acts on the session's own national ID, never on one from the
  // request (plan §6: a student reads and writes only its own row).

  app.get<{ Querystring: { saved?: string; error?: string } }>(
    "/student",
    { preHandler: requireKind("student") },
    async (request, reply) => {
      const s = await findStudent(studentId(request));
      if (!s) {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.redirect("/");
      }
      const { saved, error } = request.query;
      let message: Notice | undefined;
      if (saved) message = { kind: "ok", text: T.student.saved };
      else if (error && error in T.student.errors) {
        message = { kind: "error", text: T.student.errors[error as StudentError] };
      }
      return html(reply, studentPage(s, await listGifts(), message));
    },
  );

  app.get<{ Querystring: { gift?: string } }>(
    "/student/confirm",
    { preHandler: requireKind("student") },
    async (request, reply) => {
      const gift = (await listGifts()).find((g) => g.id === Number(request.query.gift));
      if (!gift) return reply.redirect("/student?error=unknown_gift");
      return html(reply, confirmPage(gift));
    },
  );

  app.post<{ Body: { gift_id?: string } }>(
    "/student/select",
    { preHandler: requireKind("student") },
    async (request, reply) => {
      const result = await selectGift(studentId(request), Number(request.body?.gift_id));
      return reply.redirect(result.ok ? "/student?saved=1" : `/student?error=${result.reason}`);
    },
  );

  // ---- staff --------------------------------------------------------------------------
  // The national ID always travels in a POST body, so it never enters a URL, a browser
  // history, or an access log (plan §12). So search answers with a page, not a redirect.

  app.get("/staff", { preHandler: requireKind("staff") }, async (request, reply) => {
    return html(reply, staffPage({ email: staffEmail(request), stats: await staffStats() }));
  });

  app.post<{ Body: { national_id?: string } }>(
    "/staff/lookup",
    { preHandler: requireKind("staff") },
    async (request, reply) => {
      const id = (request.body?.national_id ?? "").trim();
      const student = id ? await findStudent(id) : null;
      return html(reply, staffPage({ email: staffEmail(request), stats: await staffStats(), student, searched: id !== "" }));
    },
  );

  app.post<{ Body: { national_id?: string } }>(
    "/staff/take",
    { preHandler: requireKind("staff") },
    async (request, reply) => {
      const id = (request.body?.national_id ?? "").trim();
      const result = await markTaken(id);
      const student = await findStudent(id);

      let message: Notice;
      if (result.ok) {
        message = { kind: "ok", text: `${T.staff.given} ${esc(student?.gift_name)}` };
      } else if (result.reason === "already_taken") {
        // Under two minutes old: almost certainly this desk's own click, on poor wifi.
        const recent = Date.now() - new Date(result.takenAt).getTime() < 2 * 60_000;
        message = recent
          ? { kind: "warn", text: T.staff.alreadyRecent }
          : { kind: "error", text: `${T.staff.alreadyOld} ${when(result.takenAt)}. ${T.staff.alreadyOldEnd}` };
      } else if (result.reason === "not_member") {
        message = { kind: "error", text: lapsedText(student?.gender ?? null) };
      } else if (result.reason === "no_selection") {
        message = { kind: "warn", text: T.staff.noSelection };
      } else {
        message = { kind: "error", text: T.staff.notFound };
      }
      return html(reply, staffPage({ email: staffEmail(request), stats: await staffStats(), student, searched: true, message }));
    },
  );

  return app;
}

// ---- start the server -----------------------------------------------------------------

if (import.meta.main) {
  const env = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set. See .env.example`);
    return value;
  };
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const list = (name: string, fallback: string) =>
    (process.env[name] ?? fallback).split(",").map((d) => d.trim().toLowerCase());

  const app = await buildApp({
    google: googleLogin({
      clientId: env("GOOGLE_CLIENT_ID"),
      clientSecret: env("GOOGLE_CLIENT_SECRET"),
      redirectUri: `${baseUrl}/auth/callback`,
    }),
    sessionSecret: env("SESSION_SECRET"),
    domains: { student: list("STUDENT_DOMAINS", "mail.huji.ac.il"), staff: list("STAFF_DOMAINS", "aguda.org") },
    devLogin: process.env.DEV_LOGIN === "1",
    demo: process.env.DEMO === "1",
    production: process.env.NODE_ENV === "production",
    origin: new URL(baseUrl).origin,
  });

  // Request 11: the periodic sync. Off unless SYNC_SOURCE is set.
  const syncSource = process.env.SYNC_SOURCE ?? "";
  let source: StudentSource | null = null;
  if (syncSource === "fake") {
    // Fake students in a production database would be indistinguishable from real ones.
    if (process.env.NODE_ENV === "production" && process.env.DEMO !== "1") {
      throw new Error("SYNC_SOURCE=fake is refused in production, unless DEMO=1");
    }
    source = new FakeSource(fakeStudents(Number(process.env.FAKE_STUDENTS ?? 2000)));
  } else if (syncSource === "university") {
    throw new Error("SYNC_SOURCE=university needs the VBA port, which is milestone M6");
  } else if (syncSource !== "") {
    throw new Error(`unknown SYNC_SOURCE: ${syncSource}`);
  }
  const schedule = source
    ? startSyncSchedule({
        source,
        minStudents: Number(process.env.SYNC_MIN_STUDENTS ?? 20000),
        intervalMs: Number(process.env.SYNC_INTERVAL_HOURS ?? 24) * 3_600_000,
        log: (entry) => console.log(JSON.stringify({ sync: entry })),
      })
    : null;
  if (!schedule) console.log("periodic sync is off (SYNC_SOURCE is empty)");

  // Finish a sync in progress before exiting, so a deploy never cuts one in half.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      await schedule?.stop();
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  // Not HOST: many shells export HOST as the machine name, which resolves to every
  // network interface, public ones included. Loopback only, unless set on purpose.
  // In production Caddy proxies to this port, so loopback is right there as well.
  await app.listen({ host: process.env.LISTEN_HOST ?? "127.0.0.1", port });
  console.log(`listening on ${baseUrl}`);
}
