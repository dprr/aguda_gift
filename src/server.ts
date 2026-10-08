import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { decide, type Domains, findStudentByEmail, type GoogleLogin, googleLogin } from "./auth.ts";
import { pool } from "./db.ts";
import { loginPage, type RefusalReason, staffPlaceholder, studentPlaceholder, T } from "./pages.ts";

export type Session = { kind: "student"; nationalId: string } | { kind: "staff"; email: string };

export type AppOptions = {
  google: GoogleLogin;
  sessionSecret: string;
  domains: Domains;
  devLogin: boolean;
  production: boolean;
  /** Requests per minute per IP on every /auth route (plan §2). */
  authRateLimit?: number;
};

const SESSION_COOKIE = "session";
const OAUTH_COOKIE = "oauth";
const SESSION_HOURS = 12; // one desk shift

export async function buildApp(options: AppOptions) {
  if (options.production && options.devLogin) {
    throw new Error("DEV_LOGIN must be off in production");
  }

  const app = Fastify({
    logger: options.production
      ? { redact: ["req.headers.cookie", "body.national_id", "national_id"] }
      : false,
  });
  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(formbody);
  await app.register(rateLimit, { global: false });

  const authLimit = {
    config: { rateLimit: { max: options.authRateLimit ?? 30, timeWindow: "1 minute" } },
  };

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

  app.get("/auth/google", authLimit, async (_request, reply) => {
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
    authLimit,
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
      authLimit,
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

  // ---- the two interfaces. M4 replaces the placeholders -------------------------------

  /** Plan §6: a student route refuses a staff session, and the reverse. 403, not 404. */
  function requireKind(kind: Session["kind"]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const session = readSession(request);
      if (!session) return reply.redirect("/");
      if (session.kind !== kind) return reply.code(403).send("Forbidden");
      (request as FastifyRequest & { session: Session }).session = session;
    };
  }

  app.get("/student", { preHandler: requireKind("student") }, async (request, reply) => {
    const session = (request as FastifyRequest & { session: Session }).session;
    if (session.kind !== "student") return;
    const r = await pool.query(
      "SELECT national_id, first_name, last_name, member FROM students WHERE national_id = $1",
      [session.nationalId],
    );
    if (r.rowCount === 0) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.redirect("/");
    }
    return reply.type("text/html").send(studentPlaceholder(r.rows[0]));
  });

  app.get("/staff", { preHandler: requireKind("staff") }, async (request, reply) => {
    const session = (request as FastifyRequest & { session: Session }).session;
    if (session.kind !== "staff") return;
    return reply.type("text/html").send(staffPlaceholder(session.email));
  });

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
    production: process.env.NODE_ENV === "production",
  });

  const port = Number(process.env.PORT ?? 3000);
  // Not HOST: many shells export HOST as the machine name, which resolves to every
  // network interface, public ones included. Loopback only, unless set on purpose.
  // In production Caddy proxies to this port, so loopback is right there as well.
  await app.listen({ host: process.env.LISTEN_HOST ?? "127.0.0.1", port });
  console.log(`listening on ${baseUrl}`);
}
