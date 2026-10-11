/**
 * Request 22. Every student, member or not, submits this survey before selecting a gift.
 *
 * The questions live here, in code. To change them, edit SURVEY, raise `version`, and
 * deploy. A student who already submitted is never asked again (owner's decision), and
 * the stored `version` shows which questions that student answered.
 *
 * Every `id` must stay stable once students have answered it, because the answers are
 * stored under it. Rename the label freely; never reuse an id for a different question.
 */
import { Rollback, transaction } from "./db.ts";

type Base = {
  /** Stable key in the stored answers. Lowercase, no spaces. */
  id: string;
  /** Hebrew, masculine form. Used when the gender is unknown. */
  label: string;
  /** Hebrew, feminine form, if the wording changes for a woman. */
  labelFemale?: string;
  required: boolean;
};
export type Option = { value: string; label: string };
export type Question =
  | (Base & { kind: "text" })
  | (Base & { kind: "choice"; options: Option[] }) // exactly one
  | (Base & { kind: "multi"; options: Option[] }); // any number

export type Survey = { version: number; questions: Question[] };

/** The live survey. The owner supplies the questions. */
export const SURVEY: Survey = {
  version: 1,
  questions: [],
};

export type Answers = Record<string, string | string[]>;
const MAX_TEXT = 1000;

/**
 * Check a submitted form against the survey. Returns the clean answers, or an error per
 * question. Fields that are not questions are ignored.
 */
export function validate(
  survey: Survey,
  body: Record<string, unknown>,
): { ok: true; answers: Answers } | { ok: false; errors: Record<string, "required" | "invalid"> } {
  const answers: Answers = {};
  const errors: Record<string, "required" | "invalid"> = {};

  for (const q of survey.questions) {
    const raw = body[q.id];
    if (q.kind === "text") {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value.length > MAX_TEXT) errors[q.id] = "invalid";
      else if (value) answers[q.id] = value;
      else if (q.required) errors[q.id] = "required";
    } else {
      const allowed = new Set(q.options.map((o) => o.value));
      const values = (Array.isArray(raw) ? raw : raw === undefined || raw === "" ? [] : [raw]).map(String);
      if (values.some((v) => !allowed.has(v))) errors[q.id] = "invalid";
      else if (q.kind === "choice" && values.length > 1) errors[q.id] = "invalid";
      else if (values.length === 0) {
        if (q.required) errors[q.id] = "required";
      } else answers[q.id] = q.kind === "choice" ? values[0] : [...new Set(values)];
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

export type SubmitResult = { ok: true } | { ok: false; reason: "unknown_student" | "already_submitted" };

/**
 * Store the answers, once. The rule sits in the WHERE clause, so two simultaneous
 * submissions cannot both pass, and a submitted survey can never be overwritten.
 */
export async function submitSurvey(nationalId: string, survey: Survey, answers: Answers): Promise<SubmitResult> {
  return transaction(async (db) => {
    const r = await db.query(
      `UPDATE students
          SET survey = jsonb_build_object('version', $2::int, 'submitted_at', now(), 'answers', $3::jsonb)
        WHERE national_id = $1 AND survey IS NULL`,
      [nationalId, survey.version, JSON.stringify(answers)],
    );
    if (r.rowCount === 0) {
      const exists = await db.query("SELECT 1 FROM students WHERE national_id = $1", [nationalId]);
      throw new Rollback<SubmitResult>({
        ok: false,
        reason: exists.rowCount ? "already_submitted" : "unknown_student",
      });
    }
    return { ok: true };
  });
}
