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
export type Option = {
  value: string;
  label: string;
  /** Hebrew, feminine form, if the wording changes for a woman. */
  labelFemale?: string;
  /**
   * A follow-up that appears only when this option is picked, and is then required:
   * a text box, a dropdown, or checkboxes (at least one). Stored beside the answer under
   * followKey().
   */
  follow?:
    | { kind: "text" }
    | { kind: "select"; groups: { label: string; options: Option[] }[] }
    | { kind: "multi"; options: Option[]; otherText?: string };
};
export type Question =
  | (Base & { kind: "text" })
  // exactly one. dropdown: a <select> box instead of radio buttons.
  | (Base & { kind: "choice"; options: Option[]; dropdown?: boolean })
  | (Base & { kind: "multi"; options: Option[] }); // any number

export type Survey = { version: number; questions: Question[] };

/** The HUJI dorms, as the owner listed them on 2026-10-23. This list replaces every earlier one. */
const DORMS = [
  { label: "הר הצופים", options: [
    { value: "kfar_hastudentim", label: "כפר הסטודנטים" },
    { value: "reznik", label: "רזניק" },
  ] },
  { label: "גבעת רם", options: [
    { value: "brandman", label: "ברנדמן" },
    { value: "zweig", label: "צוויג" },
    { value: "lieberman", label: "ליברמן" },
  ] },
  { label: "עין כרם", options: [
    { value: "boston", label: "בוסטון" },
    { value: "guatemala", label: "גואטמלה" },
    { value: "stern", label: "שטרן" },
  ] },
  { label: "רחובות", options: [
    { value: "faculty_dorms", label: "מעונות הפקולטה" },
    { value: "shikun_binui", label: "שיכון ובינוי (לא תחת האוניברסיטה)" },
  ] },
];

/**
 * The special populations a student can mark, as the owner listed them on 2026-10-26 (any
 * number). Each has a masculine label and, where it differs, a feminine one. "אחר" opens an
 * optional text box (otherText), where a student can also detail a disability.
 */
const SPECIAL_POPULATIONS: Option[] = [
  { value: "haredi", label: "חרדי", labelFemale: "חרדית" },
  { value: "religious", label: "דתי", labelFemale: "דתייה" },
  { value: "traditional", label: "מסורתי", labelFemale: "מסורתית" },
  { value: "secular", label: "חילוני", labelFemale: "חילונית" },
  { value: "muslim", label: "מוסלמי", labelFemale: "מוסלמית" },
  { value: "christian", label: "נוצרי", labelFemale: "נוצרייה" },
  { value: "druze", label: "דרוזי", labelFemale: "דרוזית" },
  { value: "circassian", label: "צ'רקסי", labelFemale: "צ'רקסית" },
  { value: "ethiopian", label: "משתייך לקהילת יוצאי אתיופיה", labelFemale: "משתייכת לקהילת יוצאי אתיופיה" },
  { value: "lgbtq", label: "משתייך לקהילת הלהט\"ב", labelFemale: "משתייכת לקהילת הלהט\"ב" },
  {
    value: "disability",
    label: "אדם עם מוגבלות (כדי לפרט את סוג המוגבלות, בחר גם \"אחר\" וכתוב שם)",
    labelFemale: "אדם עם מוגבלות (כדי לפרט את סוג המוגבלות, בחרי גם \"אחר\" וכתבי שם)",
  },
  { value: "other", label: "אחר" },
];

const YES_NO: Option[] = [
  { value: "yes", label: "כן" },
  { value: "no", label: "לא" },
];

/**
 * The live survey. Version 1: the owner reset the version, and deleted every earlier answer,
 * on 2026-10-20. Version 2: the owner's new special-population list (2026-10-26).
 * Version 3: the social-media question is removed, and with it the media links.
 * Version 4: the four optional extra questions are removed, with their checkbox.
 */
export const SURVEY: Survey = {
  version: 4,
  questions: [
    {
      id: "dorms",
      kind: "choice",
      label: "האם אתה גר במעונות?",
      labelFemale: "האם את גרה במעונות?",
      required: true,
      options: [
        { value: "yes", label: "כן", follow: { kind: "select", groups: DORMS } },
        { value: "no", label: "לא" },
      ],
    },
    {
      id: "reserve",
      kind: "choice",
      label: "האם אתה משרת מילואים?",
      labelFemale: "האם את משרתת מילואים?",
      required: true,
      options: YES_NO,
    },
    {
      id: "special",
      kind: "choice",
      dropdown: true,
      label: "האם אתה מאוכלוסייה מיוחדת?",
      labelFemale: "האם את מאוכלוסייה מיוחדת?",
      required: true,
      options: [
        { value: "yes", label: "כן", follow: { kind: "multi", options: SPECIAL_POPULATIONS, otherText: "other" } },
        { value: "no", label: "לא" },
      ],
    },
    {
      id: "more",
      kind: "text",
      label: "משהו נוסף שתרצה לשתף אותנו?",
      labelFemale: "משהו נוסף שתרצי לשתף אותנו?",
      required: false,
    },
  ],
};

/** The form field and the stored key of an option's follow-up: <id>_text, _choice, or _choices. */
export const followKey = (questionId: string, follow: NonNullable<Option["follow"]>) =>
  `${questionId}_${{ text: "text", select: "choice", multi: "choices" }[follow.kind]}`;

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
      } else {
        answers[q.id] = q.kind === "choice" ? values[0] : [...new Set(values)];
        // A follow-up, such as the "אחר" text or the dorms dropdown: required once its
        // option is chosen. The follow-up of an option that was not chosen is dropped.
        for (const o of q.options) {
          if (!o.follow || !values.includes(o.value)) continue;
          const key = followKey(q.id, o.follow);
          const raw = body[key];
          if (o.follow.kind === "multi") {
            const allowed = new Set(o.follow.options.map((x) => x.value));
            const picked = (Array.isArray(raw) ? raw : raw === undefined || raw === "" ? [] : [raw]).map(String);
            if (picked.some((v) => !allowed.has(v))) errors[q.id] = "invalid";
            else if (picked.length === 0) errors[q.id] = "required";
            else {
              answers[key] = [...new Set(picked)];
              // The optional text of the otherText option, kept only when it is checked.
              if (o.follow.otherText && picked.includes(o.follow.otherText)) {
                const raw = body[`${key}_text`];
                const text = typeof raw === "string" ? raw.trim() : "";
                if (text.length > MAX_TEXT) errors[q.id] = "invalid";
                else if (text) answers[`${key}_text`] = text;
              }
            }
            continue;
          }
          const value = typeof raw === "string" ? raw.trim() : "";
          if (!value) errors[q.id] = "required";
          else if (o.follow.kind === "text" && value.length > MAX_TEXT) errors[q.id] = "invalid";
          else if (o.follow.kind === "select" && !o.follow.groups.some((g) => g.options.some((x) => x.value === value))) {
            errors[q.id] = "invalid";
          } else answers[key] = value;
        }
      }
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
