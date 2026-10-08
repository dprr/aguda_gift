/**
 * Plan §2. One login page. The `hd` claim inside Google's signed ID token decides the
 * session kind. The browser never chooses it.
 */
import { OAuth2Client } from "google-auth-library";
import { pool } from "./db.ts";

/** The claims the decision reads. Google signs them; the verifier below checks that. */
export type Claims = { email?: string; email_verified?: boolean; hd?: string };

export type Domains = { student: string[]; staff: string[] };

export type Decision =
  | { kind: "student"; email: string }
  | { kind: "staff"; email: string }
  | { kind: "refused"; reason: "unverified_email" | "no_domain" | "wrong_domain" };

/** Pure. Request 10: `mail.huji.ac.il` → student, `aguda.org` → staff, anything else → refused. */
export function decide(claims: Claims, domains: Domains): Decision {
  if (claims.email_verified !== true || !claims.email) {
    return { kind: "refused", reason: "unverified_email" };
  }
  // A personal Gmail account sends no hd claim at all. That is a refusal, not "".
  if (typeof claims.hd !== "string" || claims.hd === "") {
    return { kind: "refused", reason: "no_domain" };
  }
  const hd = claims.hd.toLowerCase();
  const email = claims.email.toLowerCase();
  if (domains.student.includes(hd)) return { kind: "student", email };
  if (domains.staff.includes(hd)) return { kind: "staff", email };
  return { kind: "refused", reason: "wrong_domain" };
}

/** A student session needs a row. Both sides are lowercase (plan §2). */
export async function findStudentByEmail(email: string): Promise<string | null> {
  const r = await pool.query(
    "SELECT national_id FROM students WHERE university_email = $1",
    [email.toLowerCase()],
  );
  return r.rows[0]?.national_id ?? null;
}

// ---------------------------------------------------------------------------------------
// Google. Tests replace this with a stub, so they never call Google.

export interface GoogleLogin {
  /** Where to send the browser, and the PKCE verifier to keep for the callback. */
  start(state: string): Promise<{ url: string; codeVerifier: string }>;
  /** Exchange the code, verify the ID token's signature, audience, and expiry. */
  finish(code: string, codeVerifier: string): Promise<Claims>;
}

export function googleLogin(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleLogin {
  const client = new OAuth2Client({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
  });

  return {
    async start(state) {
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const url = client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        prompt: "select_account", // a student who works for Aguda holds two accounts
        code_challenge: codeChallenge,
        code_challenge_method: "S256" as never,
      });
      return { url, codeVerifier: codeVerifier as string };
    },

    async finish(code, codeVerifier) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw new Error("Google returned no ID token");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: options.clientId,
      });
      const p = ticket.getPayload();
      if (!p) throw new Error("Google returned an ID token with no payload");
      return { email: p.email, email_verified: p.email_verified, hd: p.hd };
    },
  };
}
