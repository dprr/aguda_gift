/**
 * Server-rendered pages for M3: the login page, its errors, and two placeholders that M4
 * replaces. Every Hebrew string lives in `T`, so a later English pass edits one object
 * (plan §7).
 */

export const T = {
  title: "מתנות האגודה",
  signIn: "התחברות עם Google",
  signInHint: "סטודנטים: חשבון האוניברסיטה (mail.huji.ac.il). צוות: חשבון האגודה (aguda.org).",
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
  studentPlaceholder: "אזור הסטודנט ייבנה באבן הדרך M4.",
  staffPlaceholder: "אזור הצוות ייבנה באבן הדרך M4.",
  member: { true: "חבר אגודה", false: "לא חבר אגודה", null: "סטטוס חברות לא ידוע" },
} as const;

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

function layout(body: string): string {
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
</style>
</head>
<body><main>${body}</main></body>
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
<p class="hint">${T.signInHint}</p>
${dev}`);
}

const logoutForm = `<form method="post" action="/auth/logout"><button class="button">${T.logout}</button></form>`;

export function studentPlaceholder(s: {
  first_name: string | null;
  last_name: string | null;
  national_id: string;
  member: boolean | null;
}): string {
  return layout(`<h1>${esc(s.first_name)} ${esc(s.last_name)}</h1>
<p>${ltr(s.national_id)}</p>
<p><strong>${T.member[String(s.member) as "true" | "false" | "null"]}</strong></p>
<p class="hint">${T.studentPlaceholder}</p>
${logoutForm}`);
}

export function staffPlaceholder(email: string): string {
  return layout(`<h1>${T.title}</h1>
<p>${ltr(email)}</p>
<p class="hint">${T.staffPlaceholder}</p>
${logoutForm}`);
}
