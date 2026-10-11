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
   * a text box, or a dropdown. Stored beside the answer under followKey().
   */
  follow?: { kind: "text" } | { kind: "select"; groups: { label: string; options: Option[] }[] };
};
export type Question =
  | (Base & { kind: "text"; campusSocial?: boolean })
  // exactly one. dropdown: a <select> box instead of radio buttons; its options take no follow-up.
  | (Base & { kind: "choice"; options: Option[]; campusSocial?: boolean; dropdown?: boolean })
  | (Base & { kind: "multi"; options: Option[]; campusSocial?: boolean }); // any number
// campusSocial: show the Aguda Instagram and WhatsApp links of the student's own campus.

export type Survey = { version: number; questions: Question[] };

/** The HUJI dorms, from the official brochure מעונות תשפ"ו 2025-2026, p. 6. */
const DORMS = [
  { label: "הר הצופים", options: [
    { value: "kfar_hastudentim", label: "כפר הסטודנטים" },
    { value: "bronfman", label: "ברונפמן (אידלסון)" },
    { value: "meyersdorf", label: "מאירסדורף (רזניק)" },
  ] },
  { label: "קמפוס אדמונד י. ספרא (גבעת רם)", options: [
    { value: "zweig", label: "צוויג" },
    { value: "lieberman", label: "ליברמן" },
  ] },
  { label: "עין כרם", options: [
    { value: "boston", label: "בוסטון" },
    { value: "guatemala", label: "גואטמלה" },
    { value: "stern", label: "שטרן" },
  ] },
  { label: "רחובות", options: [{ value: "rehovot", label: "רחובות" }] },
];

const YES_NO: Option[] = [
  { value: "yes", label: "כן" },
  { value: "no", label: "לא" },
];

/**
 * The live survey, as supplied by the owner on 2026-10-11.
 * Version 2: singular, gendered wording instead of אתם, and the spelling ליהנות.
 * Version 3: five more questions.
 * Version 4: fences takes several answers; the elections question, as a dropdown.
 */
export const SURVEY: Survey = {
  version: 4,
  questions: [
    {
      id: "fences",
      kind: "multi", // at least one, because required
      label: "מה אתה חושב על הגדרות החדשות בגבעת רם?",
      labelFemale: "מה את חושבת על הגדרות החדשות בגבעת רם?",
      required: true,
      options: [
        { value: "disaster", label: "אסון לאומי" },
        { value: "technion", label: "שוקל לעבור לטכניון בגלל זה", labelFemale: "שוקלת לעבור לטכניון בגלל זה" },
        { value: "other", label: "אחר", follow: { kind: "text" } },
      ],
    },
    {
      id: "father",
      kind: "choice",
      label: "אבא שלך ערומקו?",
      required: true,
      options: [{ value: "no", label: "לא" }],
    },
    {
      id: "welfare",
      kind: "choice",
      label: "האם אתה צופה ליהנות מהטבה שתשלום דמי רווחה נותנת?",
      labelFemale: "האם את צופה ליהנות מהטבה שתשלום דמי רווחה נותנת?",
      required: true,
      options: YES_NO,
    },
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
      label: "האם אתה מאוכלוסייה מיוחדת?",
      labelFemale: "האם את מאוכלוסייה מיוחדת?",
      required: true,
      options: [
        { value: "yes", label: "כן", follow: { kind: "text" } },
        { value: "no", label: "לא" },
      ],
    },
    {
      id: "social",
      kind: "choice",
      label: "האם אתה עוקב אחרי האינסטגרם או הוואטסאפ של האגודה?",
      labelFemale: "האם את עוקבת אחרי האינסטגרם או הוואטסאפ של האגודה?",
      required: true,
      campusSocial: true,
      options: YES_NO,
    },
    {
      id: "elections",
      kind: "choice",
      dropdown: true,
      label: "למי תצביע בבחירות הקרובות?",
      labelFemale: "למי תצביעי בבחירות הקרובות?",
      required: true,
      options: [
        { value: "pirates", label: "הפיראטים" },
        { value: "throw_away", label: "אזרוק את הקול שלי לאנשים שלא אכפת ממני" },
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

export type Social = { instagram?: string; whatsapp?: string };

/** Aguda's general links, shown to every student. Supplied by the owner on 2026-10-11. */
export const AGUDA_SOCIAL: Social = {
  instagram: "https://www.instagram.com/huji_aguda/",
  whatsapp: "https://chat.whatsapp.com/LDsyY8tCWl606fSQbVK0tJ",
};

/**
 * Each campus's own links, keyed by students.campus exactly as the university list spells
 * it. ⚠️ The keys match the fake data; confirm them against the real list (M6). A campus
 * with an entry but no WhatsApp shows a note inviting the student to start a group.
 */
export const CAMPUS_SOCIAL: Record<string, Social> = {
  "גבעת רם": {
    instagram: "https://www.instagram.com/aguda.givatram/",
    whatsapp: "https://agudagivatram.org/agudaupdates", // redirects to the group
  },
  "הר הצופים": { instagram: "https://www.instagram.com/aguda.har/" },
  "רחובות": {
    instagram: "https://www.instagram.com/hafakulta/",
    whatsapp: "https://api.whatsapp.com/send?phone=972559500921",
  },
  "עין כרם": {
    instagram: "https://www.instagram.com/aguda.hujimed/",
    whatsapp: "https://wa.me/972555660388",
  },
};

/** The form field and the stored key of an option's follow-up: <id>_text or <id>_choice. */
export const followKey = (questionId: string, follow: NonNullable<Option["follow"]>) =>
  `${questionId}_${follow.kind === "text" ? "text" : "choice"}`;

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
