import { Rollback, transaction } from "./db.ts";
import { PROFILE_COLUMNS, type SourceStudent, type StudentSource } from "./source.ts";

/** Advisory lock key. Only one sync may run at a time (plan §5.3 step 1). */
export const SYNC_LOCK_KEY = 4207;

export type SyncResult =
  | {
      ok: true;
      received: number;
      added: number;
      profileChanged: number;
      membershipChanged: number;
    }
  | { ok: false; reason: "busy" | "too_few" | "invalid"; detail: string };

/**
 * Plan §5.3. Copy the university list into `students`.
 *
 * - Validates the whole response before writing anything.
 * - Applies everything in one transaction, so any failure writes nothing.
 * - Writes a column only when its value differs, so a repeated import writes nothing.
 * - Appends to `membership_history` only when `member` changes (request 13).
 * - Never deletes a student, and leaves students absent from the response untouched.
 */
export async function syncStudents(
  source: StudentSource,
  options: { minStudents: number },
): Promise<SyncResult> {
  // Steps 2 to 4: fetch and validate. Nothing is written yet.
  const received = await source.fetchStudents();

  if (received.length < options.minStudents) {
    return {
      ok: false,
      reason: "too_few",
      detail: `received ${received.length} students, minimum is ${options.minStudents}`,
    };
  }

  const problem = findProblem(received);
  if (problem) return { ok: false, reason: "invalid", detail: problem };

  const rows = received.map((s) => ({
    ...s,
    university_email: s.university_email?.toLowerCase() ?? null,
  }));

  // Step 5: one transaction.
  return transaction(async (db) => {
    // Step 1: refuse if another sync holds the lock. Released at commit or rollback.
    const lock = await db.query("SELECT pg_try_advisory_xact_lock($1) AS got", [
      SYNC_LOCK_KEY,
    ]);
    if (!lock.rows[0].got) {
      throw new Rollback<SyncResult>({
        ok: false,
        reason: "busy",
        detail: "another sync is running",
      });
    }

    const cols = PROFILE_COLUMNS.join(", ");
    const colTypes = PROFILE_COLUMNS.map((c) => `${c} text`).join(", ");

    await db.query(
      `CREATE TEMP TABLE incoming ON COMMIT DROP AS
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS x(national_id text, ${colTypes}, member boolean)`,
      [JSON.stringify(rows)],
    );

    // New students. First sight records the membership the source reports.
    const added = await db.query(
      `INSERT INTO students (national_id, ${cols}, member, member_changed_at, membership_history)
       SELECT national_id, ${cols}, member, now(),
              jsonb_build_array(jsonb_build_object('at', now(), 'member', member))
         FROM incoming
       ON CONFLICT (national_id) DO NOTHING`,
    );

    // Existing students: profile and academic columns, only where something differs.
    const profileChanged = await db.query(
      `UPDATE students s
          SET (${cols}) = (${PROFILE_COLUMNS.map((c) => `i.${c}`).join(", ")})
         FROM incoming i
        WHERE s.national_id = i.national_id
          AND (${PROFILE_COLUMNS.map((c) => `s.${c}`).join(", ")})
              IS DISTINCT FROM
              (${PROFILE_COLUMNS.map((c) => `i.${c}`).join(", ")})`,
    );

    // Step 6: membership, only where it changed. The history entry is written in the
    // same statement, so the column and the list cannot disagree.
    const membershipChanged = await db.query(
      `UPDATE students s
          SET member = i.member,
              member_changed_at = now(),
              membership_history = s.membership_history
                || jsonb_build_array(jsonb_build_object('at', now(), 'member', i.member))
         FROM incoming i
        WHERE s.national_id = i.national_id
          AND s.member IS DISTINCT FROM i.member`,
    );

    return {
      ok: true,
      received: rows.length,
      added: added.rowCount ?? 0,
      profileChanged: profileChanged.rowCount ?? 0,
      membershipChanged: membershipChanged.rowCount ?? 0,
    };
  });
}

/** A reason the whole response must be refused, or null if it is acceptable. */
function findProblem(students: SourceStudent[]): string | null {
  const ids = new Set<string>();
  const emails = new Set<string>();

  for (const [index, s] of students.entries()) {
    if (typeof s.national_id !== "string" || s.national_id === "") {
      return `record ${index} has no national ID`;
    }
    if (ids.has(s.national_id)) {
      return `national ID appears twice, at record ${index}`;
    }
    ids.add(s.national_id);

    if (s.university_email) {
      const email = s.university_email.toLowerCase();
      if (emails.has(email)) return `university email appears twice, at record ${index}`;
      emails.add(email);
    }
  }
  return null;
}
