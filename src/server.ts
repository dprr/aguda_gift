import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { decide, type Domains, type Door, findStudentByEmail, type GoogleLogin, googleLogin } from "./auth.ts";
import { pool } from "./db.ts";
import { markTaken, resetStudent, selectGift } from "./gifts.ts";
import { confirmPage, demoBanner, esc, isFemale, lapsedText, loginPage, ltr, type ManagerDone, type ManagerError, managerPage, noSelectionText, receivedConfirmPage, resetConfirmPage, studentErrorText, type Notice, type RefusalReason, type StaffRefusal, staffLoginPage, staffPage, type StudentError, type StudentRefusal, studentPage, surveyPage, T, when } from "./pages.ts";
import { findStudent, listGifts, staffStats } from "./queries.ts";
import { startSyncSchedule } from "./schedule.ts";
import { addStaff, listStaff, RANK, removeStaff, type Role, roleOf, setStock } from "./staff.ts";
import { exportCsv, isExport } from "./export.ts";
import { SURVEY, type Survey, submitSurvey, validate } from "./survey.ts";
import { FakeSource, fakeStudents, type StudentSource } from "./source.ts";
import { UniversitySource } from "./university.ts";

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
  /** Request 22. Defaults to the live SURVEY; tests pass their own. */
  survey?: Survey;
  /** This site's origin, for example http://localhost:3000. A POST from any other is refused. */
  origin: string;
};

const SESSION_COOKIE = "session";
const OAUTH_COOKIE = "oauth";
const SESSION_HOURS = 12; // one desk shift
const IMG_DIR = join(import.meta.dirname, "..", "img");

export async function buildApp(options: AppOptions) {
  const survey = options.survey ?? SURVEY;
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

  const loginUrl = (door: Door) => (door === "staff" ? "/staff/login" : "/");
  const refuse = (reply: FastifyReply, reason: RefusalReason, door: Door = "student") =>
    reply.redirect(`${loginUrl(door)}?error=${reason}`);

  // ---- gift photos --------------------------------------------------------------------

  // Read once, at start. A request names a file from this map or gets 404, so it can
  // never reach a path outside img/.
  const images = new Map<string, Buffer>();
  for (const file of await readdir(IMG_DIR).catch(() => [])) {
    if (/\.jpe?g$/i.test(file)) images.set(file, await readFile(join(IMG_DIR, file)));
  }
  app.get<{ Params: { file: string } }>("/img/:file", async (request, reply) => {
    const image = images.get(request.params.file);
    if (!image) return reply.code(404).send("Not found");
    return reply.type("image/jpeg").header("cache-control", "public, max-age=86400").send(image);
  });

  // ---- the two login pages (request 24) ----------------------------------------------

  app.get<{ Querystring: { error?: string } }>("/", async (request, reply) => {
    const session = readSession(request);
    if (session) return reply.redirect(session.kind === "student" ? "/student" : "/staff");
    const error = request.query.error;
    const known = error && error in T.refused ? (error as StudentRefusal) : undefined;
    return reply.type("text/html").send(loginPage({ devLogin: options.devLogin, error: known }));
  });

  app.get<{ Querystring: { error?: string } }>("/staff/login", async (request, reply) => {
    // A student session may stay here: a student who also works for Aguda logs in again.
    if (readSession(request)?.kind === "staff") return reply.redirect("/staff");
    const error = request.query.error;
    const known = error && error in T.staffRefused ? (error as StaffRefusal) : undefined;
    return reply.type("text/html").send(staffLoginPage({ devLogin: options.devLogin, error: known }));
  });

  // ---- Google -------------------------------------------------------------------------

  // The door goes into the signed OAuth cookie, never into the state or the URL Google
  // sees. It only selects which list the person must be on; it grants nothing alone.
  const startGoogle = (door: Door) => async (_request: FastifyRequest, reply: FastifyReply) => {
    const state = randomBytes(16).toString("base64url");
    const { url, codeVerifier } = await options.google.start(state);
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier, door }), {
      ...cookieBase,
      maxAge: 600,
    });
    return reply.redirect(url);
  };
  app.get("/auth/google", startGoogle("student"));
  app.get("/auth/google/staff", startGoogle("staff"));

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      const raw = request.cookies[OAUTH_COOKIE];
      reply.clearCookie(OAUTH_COOKIE, { path: "/" });

      const unsigned = raw ? request.unsignCookie(raw) : { valid: false, value: null };
      let saved: { state: string; codeVerifier: string; door?: Door } | null = null;
      try {
        saved = unsigned.valid && unsigned.value ? JSON.parse(unsigned.value) : null;
      } catch {
        saved = null;
      }
      const door: Door = saved?.door === "staff" ? "staff" : "student";

      if (request.query.error) {
        return refuse(reply, request.query.error === "access_denied" ? "cancelled" : "google_error", door);
      }
      // The state must match the one this browser started with. This stops a login that
      // another site started on the person's behalf.
      if (!saved || !request.query.state || saved.state !== request.query.state || !request.query.code) {
        return refuse(reply, "expired", door);
      }

      let claims;
      try {
        claims = await options.google.finish(request.query.code, saved.codeVerifier);
      } catch (error) {
        request.log.warn({ err: error }, "Google token exchange failed");
        return refuse(reply, "google_error", door);
      }

      const decision = decide(claims, door === "staff" ? options.domains.staff : options.domains.student);
      if (decision.kind === "refused") return refuse(reply, decision.reason, door);

      if (door === "staff") {
        if (!(await roleOf(decision.email))) return refuse(reply, "not_staff", "staff");
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
        // Staff skip Google here, but never the staff list.
        const address = email?.trim().toLowerCase() ?? "";
        if (kind === "staff" && address && (await roleOf(address))) {
          setSession(reply, { kind: "staff", email: address });
          return reply.redirect("/staff");
        }
        return kind === "staff" ? refuse(reply, "not_staff", "staff") : refuse(reply, "not_in_list");
      },
    );
  }

  app.post("/auth/logout", async (request, reply) => {
    const session = readSession(request);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect(loginUrl(session?.kind === "staff" ? "staff" : "student"));
  });

  // ---- the interfaces ----------------------------------------------------------------

  type Authed = FastifyRequest & { session: Session; role?: Role };

  /** Plan §6: a student route refuses a staff session. 403, not 404. */
  async function requireStudent(request: FastifyRequest, reply: FastifyReply) {
    const session = readSession(request);
    if (!session) return reply.redirect("/");
    if (session.kind !== "student") return reply.code(403).send("Forbidden");
    (request as Authed).session = session;
  }

  /**
   * A staff route checks the role on every request (request 24). An email that left the
   * staff list loses its session at once. A worker on a manager route gets 403.
   */
  function requireStaff(needed?: "manager" | "ceo") {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const session = readSession(request);
      if (!session) return reply.redirect("/staff/login");
      if (session.kind !== "staff") return reply.code(403).send("Forbidden");
      const role = await roleOf(session.email);
      if (!role) {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return refuse(reply, "not_staff", "staff");
      }
      // Each role has everything of the role below it (request 29).
      if (needed && RANK[role] < RANK[needed]) return reply.code(403).send("Forbidden");
      (request as Authed).session = session;
      (request as Authed).role = role;
    };
  }
  const sessionOf = (request: FastifyRequest) => (request as Authed).session;
  const studentId = (request: FastifyRequest) => {
    const s = sessionOf(request);
    return s.kind === "student" ? s.nationalId : "";
  };
  const staffEmail = (request: FastifyRequest) => {
    const s = sessionOf(request);
    return s.kind === "staff" ? s.email : "";
  };
  const staffRole = (request: FastifyRequest) => (request as Authed).role ?? "worker";
  const html = (reply: FastifyReply, body: string) => noStore(reply).type("text/html").send(body);

  // ---- student ------------------------------------------------------------------------
  // Every student route acts on the session's own national ID, never on one from the
  // request (plan §6: a student reads and writes only its own row).

  app.get<{ Querystring: { saved?: string; error?: string; surveyed?: string; received?: string } }>(
    "/student",
    { preHandler: requireStudent },
    async (request, reply) => {
      const s = await findStudent(studentId(request));
      if (!s) {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.redirect("/");
      }
      // Request 22: member or not, the survey comes first.
      if (!s.survey_submitted) return html(reply, surveyPage(s, survey));

      const { saved, error, surveyed, received } = request.query;
      let message: Notice | undefined;
      if (surveyed) message = { kind: "ok", text: T.survey.thanks };
      else if (received && s.gift_taken_at) message = { kind: "ok", text: T.student.receivedSaved };
      else if (saved) message = { kind: "ok", text: T.student.saved };
      else if (error && error in T.student.errors) {
        message = { kind: "error", text: studentErrorText(error as StudentError, s.gender) };
      }
      return html(reply, studentPage(s, await listGifts(), message));
    },
  );

  app.get<{ Querystring: { gift?: string } }>(
    "/student/confirm",
    { preHandler: requireStudent },
    async (request, reply) => {
      const gift = (await listGifts()).find((g) => g.id === Number(request.query.gift));
      if (!gift) return reply.redirect("/student?error=unknown_gift");
      const s = await findStudent(studentId(request));
      if (!s?.survey_submitted) return reply.redirect("/student");
      return html(reply, confirmPage(gift, s.gender));
    },
  );

  app.post<{ Body: { gift_id?: string } }>(
    "/student/select",
    { preHandler: requireStudent },
    async (request, reply) => {
      const result = await selectGift(studentId(request), Number(request.body?.gift_id));
      return reply.redirect(result.ok ? "/student?saved=1" : `/student?error=${result.reason}`);
    },
  );

  // Request 26: the student marks the gift as received. The same markTaken() as the desk,
  // so the same rules hold: a member, with a selection, not yet collected. Only a member
  // with an open selection sees the button; any other case returns to the student page,
  // which already explains the state.
  app.get("/student/received", { preHandler: requireStudent }, async (request, reply) => {
    const s = await findStudent(studentId(request));
    if (!s || s.gift_id === null || s.gift_taken_at || s.member !== true) return reply.redirect("/student");
    return html(reply, receivedConfirmPage(s));
  });

  app.post("/student/received", { preHandler: requireStudent }, async (request, reply) => {
    const result = await markTaken(studentId(request));
    return reply.redirect(result.ok ? "/student?received=1" : "/student");
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/student/survey",
    { preHandler: requireStudent },
    async (request, reply) => {
      const body = request.body ?? {};
      const checked = validate(survey, body);
      if (!checked.ok) {
        const s = await findStudent(studentId(request));
        if (!s) return reply.redirect("/");
        return html(reply, surveyPage(s, survey, { values: body, errors: checked.errors }));
      }
      // Submitted is final: a second submission changes nothing (owner's decision).
      const result = await submitSurvey(studentId(request), survey, checked.answers);
      return reply.redirect(result.ok ? "/student?surveyed=1" : "/student");
    },
  );

  // ---- staff --------------------------------------------------------------------------
  // The university sends the national ID as a number, so an ID with leading zeros is
  // stored without them. The desk drops them too, so either spelling finds the student.
  const deskId = (value: string | undefined) => (value ?? "").trim().replace(/^0+/, "");

  // The national ID always travels in a POST body, so it never enters a URL, a browser
  // history, or an access log (plan §12). So search answers with a page, not a redirect.

  app.get("/staff", { preHandler: requireStaff() }, async (request, reply) => {
    return html(reply, staffPage({ email: staffEmail(request), role: staffRole(request), stats: await staffStats() }));
  });

  app.post<{ Body: { national_id?: string } }>(
    "/staff/lookup",
    { preHandler: requireStaff() },
    async (request, reply) => {
      const id = deskId(request.body?.national_id);
      const student = id ? await findStudent(id) : null;
      return html(reply, staffPage({ email: staffEmail(request), role: staffRole(request), stats: await staffStats(), student, searched: id !== "" }));
    },
  );

  app.post<{ Body: { national_id?: string } }>(
    "/staff/take",
    { preHandler: requireStaff() },
    async (request, reply) => {
      const id = deskId(request.body?.national_id);
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
        message = { kind: "warn", text: noSelectionText(student?.gender ?? null) };
      } else {
        message = { kind: "error", text: T.staff.notFound };
      }
      return html(reply, staffPage({ email: staffEmail(request), role: staffRole(request), stats: await staffStats(), student, searched: true, message }));
    },
  );

  // Request 30: any staff member deletes a student's selection, or the survey and the
  // selection, so the student can start again. The first POST shows a confirm page; the
  // second, with confirm=1, deletes. The national ID stays in the POST body (plan §12).
  app.post<{ Body: { national_id?: string; what?: string; confirm?: string } }>(
    "/staff/reset",
    { preHandler: requireStaff() },
    async (request, reply) => {
      const id = deskId(request.body?.national_id);
      const what = request.body?.what;
      if (what !== "gift" && what !== "all") return reply.code(400).send("Bad request");
      const before = await findStudent(id);
      if (!before) {
        return html(reply, staffPage({ email: staffEmail(request), role: staffRole(request), stats: await staffStats(), student: null, searched: true }));
      }
      if (request.body?.confirm !== "1") return html(reply, resetConfirmPage(before, what));

      const result = await resetStudent(id, what);
      const student = await findStudent(id);
      const f = isFemale(student?.gender ?? null);
      const message: Notice = result.ok
        ? { kind: "ok", text: f ? T.staff.resetDoneFemale : T.staff.resetDone }
        : result.reason === "taken"
          ? { kind: "error", text: f ? T.staff.resetTakenFemale : T.staff.resetTaken }
          : { kind: "warn", text: T.staff.resetNothing };
      return html(reply, staffPage({ email: staffEmail(request), role: staffRole(request), stats: await staffStats(), student, searched: true, message }));
    },
  );

  // ---- manager page (requests 24 and 32) ----------------------------------------------
  // Managers and ceos add and remove staff below their own level, and set each gift's
  // starting inventory. The result comes back as a short code in the redirect, so a reload
  // never repeats the action.

  app.get<{ Querystring: { done?: string; error?: string; min?: string } }>(
    "/manager",
    { preHandler: requireStaff("manager") },
    async (request, reply) => {
      const { done, error, min } = request.query;
      let message: Notice | undefined;
      if (done && done in T.manager.done) message = { kind: "ok", text: T.manager.done[done as ManagerDone] };
      else if (error && error in T.manager.errors) {
        const text = T.manager.errors[error as ManagerError];
        message = { kind: "error", text: error === "below_requested" ? `${text} ${ltr(Number(min) || 0)}.` : text };
      }
      return html(reply, managerPage({
        email: staffEmail(request),
        role: staffRole(request),
        staff: await listStaff(),
        gifts: await listGifts(),
        message,
      }));
    },
  );

  app.post<{ Body: { email?: string; role?: string } }>(
    "/manager/staff/add",
    { preHandler: requireStaff("manager") },
    async (request, reply) => {
      const result = await addStaff(request.body?.email ?? "", request.body?.role ?? "", options.domains.staff, staffRole(request));
      return reply.redirect(result.ok ? `/manager?done=${result.done}` : `/manager?error=${result.reason}`);
    },
  );

  app.post<{ Body: { email?: string } }>(
    "/manager/staff/remove",
    { preHandler: requireStaff("manager") },
    async (request, reply) => {
      const result = await removeStaff(request.body?.email ?? "", { email: staffEmail(request), role: staffRole(request) });
      return reply.redirect(result.ok ? "/manager?done=removed" : `/manager?error=${result.reason === "not_found" ? "not_found" : `remove_${result.reason}`}`);
    },
  );

  app.post<{ Body: { gift_id?: string; starting_inventory?: string } }>(
    "/manager/stock",
    { preHandler: requireStaff("manager") },
    async (request, reply) => {
      const result = await setStock(Number(request.body?.gift_id), request.body?.starting_inventory ?? "");
      if (result.ok) return reply.redirect("/manager?done=stock");
      return reply.redirect(
        result.reason === "below_requested"
          ? `/manager?error=below_requested&min=${result.min}`
          : `/manager?error=${result.reason === "invalid" ? "invalid_stock" : result.reason}`,
      );
    },
  );

  // Request 29: a ceo downloads a table as CSV. The name must be one of EXPORTS.
  app.get<{ Params: { table: string } }>(
    "/manager/export/:table",
    { preHandler: requireStaff("ceo") },
    async (request, reply) => {
      const table = request.params.table.replace(/\.csv$/, "");
      if (!isExport(table)) return reply.code(404).send("Not found");
      request.log.info({ export: table, by: staffEmail(request) }, "data export");
      const date = new Date().toISOString().slice(0, 10);
      return noStore(reply)
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="aguda-${table}-${date}.csv"`)
        .send(await exportCsv(table));
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
    domains: { student: list("STUDENT_DOMAINS", "mail.huji.ac.il"), staff: list("STAFF_DOMAINS", "mail.huji.ac.il,aguda.org.il") },
    devLogin: process.env.DEV_LOGIN === "1",
    demo: process.env.DEMO === "1",
    production: process.env.NODE_ENV === "production",
    origin: new URL(baseUrl).origin,
  });

  const managerCount = await pool.query("SELECT count(*)::int AS n FROM staff WHERE role = 'manager'");
  if (managerCount.rows[0].n === 0) {
    console.log("no manager in the staff table: nobody can add workers. Run: npm run staff -- manager <email>");
  }

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
    // Request 27. HUJI_CURRENT_YEAR has no default, so a stale year is never used silently.
    source = new UniversitySource({ key: env("HUJI_API_KEY"), year: Number(env("HUJI_CURRENT_YEAR")) });
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
