/**
 * Server-rendered pages: the login page, the student page, and the staff page. No React
 * and no build step (plan §0 over §1). Every Hebrew string lives in `T`, so a later
 * English pass edits one object (plan §7). Masculine is the neutral form: see
 * .claude/skills/hebrew-text.
 */
import type { GiftView, StaffStats, StudentView } from "./queries.ts";

export const T = {
  title: "מתנות האגודה",
  signIn: "התחברות עם חשבון mail.huji.ac.il",
  logout: "התנתקות",
  tryAgain: "חזרה להתחברות",
  devTitle: "התחברות לפיתוח בלבד",
  devStudent: "כניסה כסטודנט, לפי מספר זהות",
  devStaff: "כניסה כצוות, לפי כתובת דוא\"ל",
  devGo: "כניסה",
  refused: {
    not_in_list: "לא מצאנו אותך ברשימת האוניברסיטה. נא לפנות למשרד האגודה.",
    no_domain: "יש להתחבר עם חשבון האוניברסיטה או עם חשבון האגודה, לא עם חשבון Gmail פרטי.",
    wrong_domain: "החשבון הזה אינו חשבון של האוניברסיטה או של האגודה.",
    unverified_email: "Google לא אישר את כתובת הדוא\"ל של החשבון.",
    expired: "פג תוקף ההתחברות. נא לנסות שוב.",
    cancelled: "ההתחברות בוטלה.",
    google_error: "Google לא השלים את ההתחברות. נא לנסות שוב.",
  },
  member: { true: "חבר אגודה", false: "לא חבר אגודה", null: "סטטוס חברות לא ידוע" },
  memberFemale: { true: "חברת אגודה", false: "לא חברת אגודה", null: "סטטוס חברות לא ידוע" },

  student: {
    notMember: "לפי רשימת האוניברסיטה, אינך חבר אגודה. רק חברי אגודה יכולים לבחור מתנה.",
    notMemberFemale: "לפי רשימת האוניברסיטה, אינך חברת אגודה. רק חברי אגודה יכולים לבחור מתנה.",
    unknownMember: "אין לנו מידע על החברות שלך באגודה. נא לפנות למשרד האגודה.",
    choose: "בחירת מתנה",
    chooseHint: "אפשר לבחור מתנה אחת בלבד. הבחירה סופית.",
    select: "בחירה",
    soldOut: "אזל",
    left: "נותרו",
    confirmTitle: "אישור הבחירה",
    confirmFinal: "אחרי האישור אי אפשר לשנות את הבחירה.",
    confirm: "אישור הבחירה",
    back: "חזרה",
    yourGift: "המתנה שלך",
    collectHint: "אפשר לאסוף את המתנה בעמדת חלוקה של האגודה. יש להביא תעודת סטודנט.",
    received: "קיבלת את המתנה",
    lapsed: "החברות שלך באגודה אינה פעילה כרגע. כדי לקבל את המתנה יש לחדש את החברות.",
    saved: "הבחירה נשמרה.",
    errors: {
      sold_out: "המתנה שבחרת אזלה הרגע. אפשר לבחור מתנה אחרת.",
      already_selected: "כבר בחרת מתנה. הבחירה סופית.",
      not_member: "רק חברי אגודה יכולים לבחור מתנה.",
      unknown_gift: "המתנה לא נמצאה.",
      unknown_student: "לא מצאנו אותך ברשימת האוניברסיטה.",
    },
  },

  staff: {
    title: "עמדת חלוקה",
    search: "חיפוש סטודנט",
    nationalId: "מספר זהות",
    find: "חיפוש",
    notFound: "לא נמצא סטודנט עם מספר הזהות הזה.",
    membership: "חברות באגודה",
    updated: "מעודכן ל־",
    gift: "מתנה שנבחרה",
    noSelection: "לא נבחרה מתנה. אין למסור מתנה.",
    status: "מצב",
    takenAt: "נמסרה ב־",
    notTaken: "טרם נמסרה",
    markTaken: "סימון המתנה כנמסרה",
    lapsed: "הסטודנט אינו חבר אגודה כרגע. אין למסור את המתנה.",
    lapsedFemale: "הסטודנטית אינה חברת אגודה כרגע. אין למסור את המתנה.",
    given: "המתנה נמסרה:",
    alreadyRecent: "המתנה סומנה כנמסרה לפני רגע. כנראה הלחיצה הקודמת הצליחה. אין צורך לעשות דבר.",
    alreadyOld: "המתנה כבר נמסרה ב־",
    alreadyOldEnd: "אין למסור אותה שוב.",
    history: "היסטוריה",
    collected: "קבלת מתנה:",
    stock: "מלאי",
    stockCols: ["מתנה", "מלאי התחלתי", "נבחרו", "נמסרו", "פנויות לבחירה", "במלאי בפועל"],
    drift: "שגיאה: המונים אינם תואמים לנתוני הסטודנטים. יש לדווח למפתח.",
  },
} as const;

export type StudentError = keyof typeof T.student.errors;

export type RefusalReason = keyof typeof T.refused;

/** Escape text before it goes into HTML. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Plan §7: isolate numbers and addresses inside Hebrew text, or they render reversed. */
const ltr = (value: unknown) => `<bdi dir="ltr">${esc(value)}</bdi>`;

function layout(body: string, wide = false): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T.title}</title>
<style>
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; background: #f4f5f7;
         color: #1b1b1f; margin: 0; padding: 2rem 1rem; }
  main { max-width: 28rem; margin-inline: auto; background: #fff; border-radius: 12px;
         padding: 1.5rem; box-shadow: 0 1px 3px rgb(0 0 0 / 10%); }
  h1 { margin-block-start: 0; font-size: 1.5rem; }
  .button { display: block; text-align: center; background: #1f5f3f; color: #fff;
            border: 0; border-radius: 8px; padding: 0.9rem; font: inherit;
            font-weight: 600; text-decoration: none; width: 100%; cursor: pointer; }
  .hint { color: #5f6470; font-size: 0.9rem; }
  .error { background: #fdeaea; color: #9c1f1f; border-radius: 8px; padding: 0.8rem;
           font-weight: 600; }
  fieldset { border: 1px dashed #c33; border-radius: 8px; margin-block-start: 2rem; }
  legend { color: #c33; font-weight: 600; }
  input { font: inherit; padding: 0.5rem; width: 100%; box-sizing: border-box;
          margin-block: 0.3rem 0.6rem; }
  main.wide { max-width: 46rem; }
  .ok { background: #e9f5ee; color: #1f5f3f; border-radius: 8px; padding: 0.8rem;
        font-weight: 600; }
  .warn { background: #fdf3e5; color: #8a4b00; border-radius: 8px; padding: 0.8rem;
          font-weight: 600; }
  .gifts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
           gap: 0.75rem; }
  .gift { border: 2px solid #d6d8de; border-radius: 10px; padding: 0.9rem;
          display: flex; flex-direction: column; gap: 0.4rem; }
  .gift.out { opacity: 0.5; }
  .gift strong { font-size: 1.1rem; }
  .big { font-size: 1.5rem; font-weight: 700; margin: 0.3rem 0; }
  .button.disabled { background: #9aa0a6; cursor: default; }
  .button.secondary { background: #fff; color: #1b1b1f; border: 1px solid #d6d8de;
                      margin-block-start: 0.5rem; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .bar form .button { width: auto; padding: 0.4rem 0.9rem; }
  .card { border: 1px solid #d6d8de; border-radius: 10px; padding: 1rem;
          margin-block: 1rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1rem; }
  dt { color: #5f6470; }
  dd { margin: 0; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border-block-end: 1px solid #e3e5ea; padding: 0.4rem; text-align: start; }
  section { margin-block-start: 1.5rem; }
</style>
</head>
<body><main${wide ? ' class="wide"' : ""}>${body}</main></body>
</html>`;
}

export function loginPage(options: { devLogin: boolean; error?: RefusalReason }): string {
  const error = options.error ? `<p class="error">${T.refused[options.error]}</p>` : "";
  const dev = options.devLogin
    ? `<fieldset>
  <legend>${T.devTitle}</legend>
  <form method="post" action="/auth/dev">
    <label>${T.devStudent}<input name="national_id" dir="ltr" inputmode="numeric" placeholder="100000002"></label>
    <button class="button" name="kind" value="student">${T.devGo}</button>
  </form>
  <form method="post" action="/auth/dev">
    <label>${T.devStaff}<input name="email" dir="ltr" placeholder="dev@aguda.org"></label>
    <button class="button" name="kind" value="staff">${T.devGo}</button>
  </form>
</fieldset>`
    : "";
  return layout(`<h1>${T.title}</h1>
${error}
<a class="button" href="/auth/google">${T.signIn}</a>
${dev}`);
}

const logoutForm = `<form method="post" action="/auth/logout"><button class="button secondary">${T.logout}</button></form>`;

const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", // plan §4: store UTC, display local time
  dateStyle: "short",
  timeStyle: "short",
});
/** A timestamp as local Jerusalem time, isolated left-to-right inside Hebrew text. */
export const when = (value: Date | string | null) => (value ? ltr(clock.format(new Date(value))) : "");

/**
 * The skill's rule: a known woman gets the feminine form. Masculine is the neutral form
 * only when the gender is unknown. The university's gender codes are unconfirmed (§4.2), so
 * any value not listed here falls back to the masculine.
 */
const FEMALE = new Set(["נקבה", "f", "female"]);
export const isFemale = (gender: string | null) =>
  gender !== null && FEMALE.has(gender.trim().toLowerCase());

const memberLabel = (member: boolean | null, gender: string | null) =>
  (isFemale(gender) ? T.memberFemale : T.member)[String(member) as "true" | "false" | "null"];

/** Staff: this student is not a member now, so do not hand the gift over. */
export const lapsedText = (gender: string | null) =>
  isFemale(gender) ? T.staff.lapsedFemale : T.staff.lapsed;

// ---- student ---------------------------------------------------------------------------

export type Notice = { kind: "ok" | "error" | "warn"; text: string };
const notice = (n?: Notice) => (n ? `<p class="${n.kind}">${n.text}</p>` : "");

export function studentPage(s: StudentView, gifts: GiftView[], message?: Notice): string {
  const head = `<div class="bar"><h1>${esc(s.first_name)} ${esc(s.last_name)}</h1>${logoutForm}</div>
<p>${ltr(s.national_id)} · <strong>${memberLabel(s.member, s.gender)}</strong></p>
${notice(message)}`;

  // Collected: nothing more to do.
  if (s.gift_taken_at) {
    return layout(`${head}
<div class="card"><p>${T.student.received}</p><p class="big">${esc(s.gift_name)}</p>
<p class="hint">${when(s.gift_taken_at)}</p></div>`);
  }

  // Selected, not collected. A lapsed member keeps the unit, but must renew (request 20).
  if (s.gift_id !== null) {
    const lapsed = s.member !== true ? `<p class="warn">${T.student.lapsed}</p>` : "";
    return layout(`${head}
<div class="card"><p>${T.student.yourGift}</p><p class="big">${esc(s.gift_name)}</p>
<p class="hint">${T.student.chooseHint}</p>${lapsed}
<p>${T.student.collectHint}</p></div>`);
  }

  // No selection, and not a member: nothing to choose.
  if (s.member !== true) {
    const text =
      s.member === null
        ? T.student.unknownMember
        : isFemale(s.gender) ? T.student.notMemberFemale : T.student.notMember;
    return layout(`${head}<p class="warn">${text}</p>`);
  }

  // A member with no selection: the four gifts. A sold-out gift cannot be chosen (request 19).
  const cards = gifts
    .map((g) =>
      g.selectable > 0
        ? `<div class="gift"><strong>${esc(g.name)}</strong><span class="hint">${esc(g.description)}</span>
<a class="button" href="/student/confirm?gift=${g.id}">${T.student.select}</a></div>`
        : `<div class="gift out"><strong>${esc(g.name)}</strong><span class="hint">${esc(g.description)}</span>
<span class="button disabled" aria-disabled="true">${T.student.soldOut}</span></div>`,
    )
    .join("\n");
  return layout(`${head}
<h2>${T.student.choose}</h2>
<p class="hint">${T.student.chooseHint}</p>
<div class="gifts">${cards}</div>`);
}

/** The selection is final (request 3), so it takes a second, explicit step. */
export function confirmPage(gift: GiftView): string {
  return layout(`<h1>${T.student.confirmTitle}</h1>
<p class="big">${esc(gift.name)}</p>
<p class="warn">${T.student.confirmFinal}</p>
<form method="post" action="/student/select">
  <input type="hidden" name="gift_id" value="${gift.id}">
  <button class="button">${T.student.confirm}</button>
</form>
<a class="button secondary" href="/student">${T.student.back}</a>`);
}

// ---- staff -----------------------------------------------------------------------------

function studentCard(s: StudentView, giftNames: Map<number, string>): string {
  let action = "";
  if (s.gift_id === null) action = `<p class="warn">${T.staff.noSelection}</p>`;
  else if (s.gift_taken_at) action = "";
  else if (s.member !== true) action = `<p class="error">${lapsedText(s.gender)}</p>`;
  else {
    // The national ID travels in the POST body, never in a URL (plan §12).
    action = `<form method="post" action="/staff/take">
  <input type="hidden" name="national_id" value="${esc(s.national_id)}">
  <button class="button">${T.staff.markTaken}</button>
</form>`;
  }

  const history = s.interactions.length
    ? `<h3>${T.staff.history}</h3><ul>${s.interactions
        .map((i) => `<li>${when(i.at)} ${T.staff.collected} ${esc(giftNames.get(i.gift_id!) ?? i.gift_id)}</li>`)
        .join("")}</ul>`
    : "";

  return `<div class="card">
<h2>${esc(s.first_name)} ${esc(s.last_name)}</h2>
<dl>
  <dt>${T.staff.nationalId}</dt><dd>${ltr(s.national_id)}</dd>
  <dt>${T.staff.membership}</dt><dd>${memberLabel(s.member, s.gender)} <span class="hint">${T.staff.updated} ${when(s.member_changed_at)}</span></dd>
  <dt>${T.staff.gift}</dt><dd>${s.gift_name ? esc(s.gift_name) : "—"}</dd>
  <dt>${T.staff.status}</dt><dd>${s.gift_taken_at ? `${T.staff.takenAt} ${when(s.gift_taken_at)}` : T.staff.notTaken}</dd>
</dl>
${action}
${history}
</div>`;
}

export function staffPage(options: {
  email: string;
  stats: StaffStats;
  student?: StudentView | null;
  searched?: boolean;
  message?: Notice;
}): string {
  const { email, stats, student, searched, message } = options;
  const giftNames = new Map(stats.gifts.map((g) => [g.id, g.name]));

  const result = student
    ? studentCard(student, giftNames)
    : searched
      ? `<p class="error">${T.staff.notFound}</p>`
      : "";

  const rows = stats.gifts
    .map(
      (g) =>
        `<tr><td>${esc(g.name)}</td>${[g.starting_inventory, g.requested_count, g.given_count, g.selectable, g.in_box]
          .map((n) => `<td>${ltr(n)}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  const drift = stats.drift.length ? `<p class="error">${T.staff.drift}</p>` : "";

  return layout(
    `<div class="bar"><h1>${T.staff.title}</h1><span class="hint">${ltr(email)}</span>${logoutForm}</div>
${drift}
<form method="post" action="/staff/lookup">
  <label>${T.staff.search}<input name="national_id" dir="ltr" inputmode="numeric" autofocus autocomplete="off"></label>
  <button class="button">${T.staff.find}</button>
</form>
${notice(message)}
${result}
<section><h2>${T.staff.stock}</h2>
<table><thead><tr>${T.staff.stockCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
</section>`,
    true,
  );
}
