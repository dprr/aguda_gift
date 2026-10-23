/**
 * Server-rendered pages: the login page, the student page, and the staff page. No React
 * and no build step (plan §0 over §1). Every Hebrew string lives in `T`, so a later
 * English pass edits one object (plan §7). Masculine is the neutral form: see
 * .claude/skills/hebrew-text.
 */
import type { GiftView, SelectionView, StaffStats, StudentView } from "./queries.ts";
import { mayManage, type Role } from "./staff.ts";
import { AGUDA_SOCIAL, CAMPUS_SOCIAL, EXTRA_FIELD, followKey, type Option, type Question, type Social, type Survey } from "./survey.ts";

export const T = {
  title: "מתנות האגודה",
  signIn: "התחבר עם חשבון mail.huji.ac.il",
  logout: "התנתק",
  logoutFemale: "התנתקי",
  devTitle: "התחברות לפיתוח בלבד",
  devStudent: "כניסה כסטודנט, לפי מספר זהות",
  devStaff: "כניסה כצוות, לפי כתובת דוא\"ל",
  devGo: "היכנס",
  /** Request 24: the student login page links to the staff login page, and back. */
  staffLink: "עובד באגודה? היכנס כאן",
  studentLink: "סטודנט? היכנס כאן",
  staffLoginTitle: "כניסת צוות",
  staffSignIn: "התחבר עם חשבון האוניברסיטה או האגודה",
  /** Refusals on the student login page. */
  refused: {
    not_in_list: "לא מצאנו אותך ברשימת האוניברסיטה. פנה למשרד האגודה.",
    no_domain: "התחבר עם חשבון האוניברסיטה, לא עם חשבון Gmail פרטי.",
    wrong_domain: "החשבון הזה אינו חשבון של האוניברסיטה. התחבר עם חשבון mail.huji.ac.il.",
    unverified_email: "Google לא אישר את כתובת הדוא\"ל של החשבון.",
    expired: "פג תוקף ההתחברות. נסה שוב.",
    cancelled: "ביטלת את ההתחברות.",
    google_error: "Google לא השלים את ההתחברות. נסה שוב.",
  },
  /** Refusals on the staff login page. */
  staffRefused: {
    not_staff: "החשבון הזה אינו ברשימת הצוות. פנה למנהל באגודה.",
    removed_lookups: "הסרנו אותך מרשימת הצוות, אחרי 5 חיפושים ברצף של מספר זהות שאינו קיים. פנה למנהל באגודה.",
    no_domain: "התחבר עם חשבון האוניברסיטה או עם חשבון האגודה, לא עם חשבון Gmail פרטי.",
    wrong_domain: "החשבון הזה אינו חשבון של האוניברסיטה או של האגודה.",
    unverified_email: "Google לא אישר את כתובת הדוא\"ל של החשבון.",
    expired: "פג תוקף ההתחברות. נסה שוב.",
    cancelled: "ביטלת את ההתחברות.",
    google_error: "Google לא השלים את ההתחברות. נסה שוב.",
  },
  member: { true: "חבר אגודה", false: "לא חבר אגודה", null: "סטטוס חברות לא ידוע" },
  memberFemale: { true: "חברת אגודה", false: "לא חברת אגודה", null: "סטטוס חברות לא ידוע" },

  student: {
    notMember: "לפי רשימת האוניברסיטה, אינך חבר אגודה. רק חברי אגודה יכולים לבחור מתנה.",
    notMemberFemale: "לפי רשימת האוניברסיטה, אינך חברת אגודה. רק חברי אגודה יכולים לבחור מתנה.",
    unknownMember: "אין לנו מידע על החברות שלך באגודה. פנה למשרד האגודה.",
    /** Request 37: a non-member sees how to register, instead of the gifts. */
    register: "כדי להירשם לאגודה, עקוב אחרי השלבים בתמונה. לחץ על התמונה כדי להגדיל אותה.",
    registerFemale: "כדי להירשם לאגודה, עקבי אחרי השלבים בתמונה. לחצי על התמונה כדי להגדיל אותה.",
    registerAlt: "הוראות הרשמה לאגודה דרך אפליקציית MyHuji ודרך המידע האישי באתר האוניברסיטה",
    unknownMemberFemale: "אין לנו מידע על החברות שלך באגודה. פני למשרד האגודה.",
    choose: "בחירת מתנה",
    chooseHint: "בחר מתנה אחת בלבד. הבחירה סופית.",
    chooseHintFemale: "בחרי מתנה אחת בלבד. הבחירה סופית.",
    select: "בחר",
    selectFemale: "בחרי",
    soldOut: "אזל",
    confirmTitle: "אישור הבחירה",
    confirmFinal: "אחרי האישור לא תוכל לשנות את הבחירה.",
    confirmFinalFemale: "אחרי האישור לא תוכלי לשנות את הבחירה.",
    confirm: "אשר את הבחירה",
    confirmFemale: "אשרי את הבחירה",
    back: "חזור",
    backFemale: "חזרי",
    yourGift: "המתנה שלך",
    collectHint: "אסוף את המתנה בעמדת חלוקה של האגודה, והבא תעודת סטודנט.",
    collectHintFemale: "אספי את המתנה בעמדת חלוקה של האגודה, והביאי תעודת סטודנט.",
    received: "קיבלת את המתנה",
    /** Request 26: the student marks the gift as received, as the desk would. */
    markReceived: "סמן שקיבלת את המתנה",
    markReceivedFemale: "סמני שקיבלת את המתנה",
    receivedTitle: "אישור קבלת המתנה",
    receivedWarn: "סמן רק אחרי שקיבלת את המתנה בידיים. אחרי האישור לא תוכל לבטל את הסימון, ועמדת חלוקה לא תמסור לך את המתנה.",
    receivedWarnFemale: "סמני רק אחרי שקיבלת את המתנה בידיים. אחרי האישור לא תוכלי לבטל את הסימון, ועמדת חלוקה לא תמסור לך את המתנה.",
    confirmReceived: "אשר שקיבלת את המתנה",
    confirmReceivedFemale: "אשרי שקיבלת את המתנה",
    receivedSaved: "שמרנו שקיבלת את המתנה.",
    lapsed: "החברות שלך באגודה אינה פעילה כרגע. כדי לקבל את המתנה, חדש את החברות.",
    lapsedFemale: "החברות שלך באגודה אינה פעילה כרגע. כדי לקבל את המתנה, חדשי את החברות.",
    saved: "שמרנו את הבחירה.",
    errors: {
      sold_out: "המתנה שבחרת אזלה הרגע. בחר מתנה אחרת.",
      already_selected: "כבר בחרת מתנה. הבחירה סופית.",
      not_member: "רק חברי אגודה יכולים לבחור מתנה.",
      unknown_gift: "לא מצאנו את המתנה.",
      unknown_student: "לא מצאנו אותך ברשימת האוניברסיטה.",
      survey_missing: "ענה על הסקר לפני בחירת מתנה.",
    },
    /** The feminine form of any error above whose wording changes for a woman. */
    errorsFemale: {
      sold_out: "המתנה שבחרת אזלה הרגע. בחרי מתנה אחרת.",
      survey_missing: "עני על הסקר לפני בחירת מתנה.",
    } as Partial<Record<string, string>>,
  },

  survey: {
    title: "סקר",
    intro: "לפני בחירת המתנה, ענה על הסקר.",
    introFemale: "לפני בחירת המתנה, עני על הסקר.",
    submit: "שלח",
    submitFemale: "שלחי",
    required: "חובה",
    errors: { required: "ענה על השאלה.", invalid: "התשובה אינה תקינה." },
    errorsFemale: { required: "עני על השאלה.", invalid: "התשובה אינה תקינה." },
    thanks: "תודה. שמרנו את התשובות.",
    pick: "בחר",
    pickFemale: "בחרי",
    extra: "הצג שאלות נוספות",
    extraFemale: "הציגי שאלות נוספות",
    optional: "לא חובה",
    instagramAll: "האינסטגרם של האגודה",
    whatsappAll: "הוואטסאפ של האגודה",
    instagram: "האינסטגרם של האגודה בקמפוס",
    whatsapp: "הוואטסאפ של האגודה בקמפוס",
    noWhatsapp: "אין קבוצת וואטסאפ בקמפוס",
    startOne: "הקם אחת בעצמך.",
    startOneFemale: "הקימי אחת בעצמך.",
  },

  staff: {
    title: "עמדת חלוקה",
    search: "חיפוש סטודנט",
    nationalId: "מספר זהות",
    find: "חפש",
    notFound: "לא מצאנו סטודנט עם מספר הזהות הזה.",
    /** Request 34: the warning after a wrong ID; the number of tries left follows. */
    triesLeft: "אחרי 5 חיפושים ברצף של מספר זהות שאינו קיים, נסיר אותך מרשימת הצוות. ניסיונות שנותרו:",
    membership: "חברות באגודה",
    updated: "נכון ל־",
    gift: "מתנה שנבחרה",
    noSelection: "הסטודנט לא בחר מתנה. אל תמסור מתנה.",
    noSelectionFemale: "הסטודנטית לא בחרה מתנה. אל תמסור מתנה.",
    status: "מצב",
    takenAt: "הסטודנט קיבל אותה ב־",
    takenAtFemale: "הסטודנטית קיבלה אותה ב־",
    notTaken: "הסטודנט טרם קיבל אותה",
    notTakenFemale: "הסטודנטית טרם קיבלה אותה",
    markTaken: "סמן כנמסרה",
    lapsed: "הסטודנט אינו חבר אגודה כרגע. אל תמסור את המתנה.",
    lapsedFemale: "הסטודנטית אינה חברת אגודה כרגע. אל תמסור את המתנה.",
    given: "מסרת את המתנה:",
    alreadyRecent: "כנראה הלחיצה הקודמת שלך כבר רשמה את המסירה, לפני רגע. אל תמסור את המתנה שוב.",
    alreadyOld: "עמדת חלוקה כבר מסרה את המתנה ב־",
    alreadyOldEnd: "אל תמסור אותה שוב.",
    history: "היסטוריה",
    collected: "קבלת מתנה:",
    collectionReversed: "ביטול מסירה:",
    stock: "מלאי",
    stockCols: ["מתנה", "מלאי התחלתי", "סטודנטים בחרו", "סטודנטים קיבלו", "פנויות לבחירה", "במלאי בפועל"],
    drift: "שגיאה: המונים אינם תואמים לנתוני הסטודנטים. דווח למפתח.",
    manage: "נהל עובדים ומלאי",
    /** Request 30: any staff member lets a student start again. */
    resetGift: "מחק את בחירת המתנה",
    resetAll: "מחק את הסקר ואת בחירת המתנה",
    resetSurvey: "מחק את הסקר",
    resetTitle: "אישור מחיקה",
    resetGiftWarn: "אחרי המחיקה, הסטודנט יבחר מתנה מחדש. לא נוכל לשחזר את הבחירה.",
    resetGiftWarnFemale: "אחרי המחיקה, הסטודנטית תבחר מתנה מחדש. לא נוכל לשחזר את הבחירה.",
    resetAllWarn: "אחרי המחיקה, הסטודנט ימלא את הסקר מחדש ויבחר מתנה מחדש. לא נוכל לשחזר את התשובות ואת הבחירה.",
    resetAllWarnFemale: "אחרי המחיקה, הסטודנטית תמלא את הסקר מחדש ותבחר מתנה מחדש. לא נוכל לשחזר את התשובות ואת הבחירה.",
    resetConfirm: "מחק",
    back: "חזור",
    resetDone: "מחקנו. הסטודנט יכול להתחיל מחדש.",
    resetDoneFemale: "מחקנו. הסטודנטית יכולה להתחיל מחדש.",
    resetTaken: "הסטודנט כבר קיבל את המתנה, ולכן לא מחקנו דבר.",
    resetTakenFemale: "הסטודנטית כבר קיבלה את המתנה, ולכן לא מחקנו דבר.",
    resetNothing: "לא מצאנו בחירה או סקר למחוק.",
  },

  manager: {
    title: "ניהול",
    back: "חזור לעמדת החלוקה",
    staff: "צוות",
    staffCols: ["דוא\"ל", "תפקיד", ""],
    roles: { worker: "עובד", manager: "מנהל", ceo: "מנכ\"ל" },
    managersHint: "כל איש צוות מוסיף ומסיר רק אנשי צוות בתפקיד נמוך מהתפקיד שלו. כדי להוסיף מנכ\"ל או להסיר מנכ\"ל, פנה למפתח.",
    newStaff: "כתובת דוא\"ל, בחשבון של האוניברסיטה או של האגודה",
    role: "תפקיד",
    add: "הוסף",
    remove: "הסר",
    stock: "מלאי",
    stockHint: "המלאי ההתחלתי הוא כמות היחידות שהאגודה קנתה מכל מתנה.",
    stockCols: ["מתנה", "סטודנטים בחרו", "סטודנטים קיבלו", "מלאי התחלתי"],
    save: "שמור",
    /** Request 35: alerts for the ceo about staff removed after 5 wrong IDs. */
    alertRemoved: "הסרנו מרשימת הצוות את",
    alertReason: "אחרי 5 חיפושים ברצף של מספר זהות שאינו קיים.",
    alertsClear: "נקה את ההתראות",
    /** Request 40: the ceo's list of selections, and the reversal of a handout. */
    selections: "הצג את בחירות המתנות",
    selectionsTitle: "בחירות מתנות",
    selectionsCols: ["שם", "מספר זהות", "מתנה", "מצב", ""],
    selectionsNone: "אף סטודנט עדיין לא בחר מתנה.",
    selected: "נבחרה",
    receivedAt: "נמסרה ב־",
    unmark: "סמן כלא נמסרה",
    unmarkTitle: "ביטול מסירה",
    unmarkWarn: "אחרי הביטול, המתנה תיחשב כלא נמסרה, ועמדת חלוקה תוכל למסור אותה שוב. בטל רק אם הסטודנט לא קיבל את המתנה בפועל.",
    unmarkWarnFemale: "אחרי הביטול, המתנה תיחשב כלא נמסרה, ועמדת חלוקה תוכל למסור אותה שוב. בטל רק אם הסטודנטית לא קיבלה את המתנה בפועל.",
    unmarkConfirm: "בטל את המסירה",
    unmarkDone: "ביטלנו את המסירה. המתנה במצב \"נבחרה\".",
    unmarkNotTaken: "המתנה כבר אינה מסומנת כנמסרה.",
    /** Request 33: the ceo's switch for the survey's extra questions. */
    extraTitle: "שאלות נוספות בסקר",
    extraIsOn: "הסטודנטים יכולים לפתוח את השאלות הנוספות (לא חובה).",
    extraIsOff: "הסטודנטים אינם רואים את השאלות הנוספות.",
    extraTurnOn: "הפעל את השאלות הנוספות",
    extraTurnOff: "השבת את השאלות הנוספות",
    /** Request 29: the ceo's downloads, one CSV file per table. */
    export: "הורדת הנתונים",
    exportHint: "קובץ CSV לכל טבלה. הקבצים כוללים פרטים אישיים של סטודנטים: שמור אותם במקום מוגן, ומחק אותם כשסיימת.",
    exportTables: { students: "הורד את טבלת הסטודנטים", gifts: "הורד את טבלת המתנות", staff: "הורד את טבלת הצוות" },
    done: {
      added_worker: "הוספנו את העובד.",
      added_manager: "הוספנו את המנהל.",
      added_ceo: "הוספנו את המנכ\"ל.",
      promoted_manager: "עדכנו את התפקיד למנהל.",
      promoted_ceo: "עדכנו את התפקיד למנכ\"ל.",
      removed: "הסרנו את הכתובת מרשימת הצוות.",
      stock: "שמרנו את המלאי.",
      extra_on: "הפעלנו את השאלות הנוספות.",
      extra_off: "השבתנו את השאלות הנוספות.",
    },
    errors: {
      invalid: "הכתובת אינה כתובת דוא\"ל תקינה.",
      wrong_domain: "הכתובת אינה כתובת של האוניברסיטה או של האגודה.",
      higher: "לכתובת הזו כבר יש תפקיד גבוה יותר.",
      exists: "הכתובת הזו כבר ברשימה, באותו תפקיד.",
      not_found: "הכתובת אינה ברשימת הצוות.",
      remove_forbidden: "אתה יכול להסיר רק איש צוות בתפקיד נמוך מהתפקיד שלך.",
      remove_self: "אינך יכול להסיר את עצמך.",
      invalid_role: "התפקיד אינו תקין.",
      forbidden_role: "אתה יכול לתת רק תפקיד נמוך מהתפקיד שלך.",
      invalid_stock: "הזן מספר שלם, 0 או יותר.",
      unknown_gift: "לא מצאנו את המתנה.",
      below_requested: "סטודנטים כבר בחרו במתנה הזו יותר פעמים מהמספר שהזנת. הזן לפחות",
    },
  },
} as const;

export type StudentError = keyof typeof T.student.errors;

export type StudentRefusal = keyof typeof T.refused;
export type StaffRefusal = keyof typeof T.staffRefused;
export type RefusalReason = StudentRefusal | StaffRefusal;
export type ManagerDone = keyof typeof T.manager.done;
export type ManagerError = keyof typeof T.manager.errors;

/** DEMO=1 only. Inline style, so it shows even if the page's own styles change. */
export const demoBanner = `<div role="alert" style="background:#9c1f1f;color:#fff;font-weight:700;text-align:center;padding:0.7rem;margin:-2rem -1rem 1.5rem">${"גרסת הדגמה. כל הנתונים בדויים, וכל אחד יכול להתחבר בתור כל משתמש. אל תזין מידע אמיתי."}</div>`;

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
export const ltr = (value: unknown) => `<bdi dir="ltr">${esc(value)}</bdi>`;

function layout(body: string, wide = false): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<title>${T.title}</title>
<style>
  /* Dark theme. Every color is here, so a change of theme edits only this block. */
  :root {
    color-scheme: dark;            /* dark form controls, checkboxes, and scrollbars */
    --bg: #000;                    /* the page */
    --surface: #121316;            /* the main panel */
    --raised: #1b1c20;             /* inputs, photos, secondary buttons */
    --border: #34363c;
    --text: #fff;
    --muted: #a1a1aa;              /* hints and labels */
    --green: #1f5f3f;              /* buttons, as in the light theme */
    --green-focus: #4ade80;
    --link: #7cc4ff;
    --link-visited: #c4a7ff;
    --ok-bg: #0f2e1f;    --ok: #7ee2a8;
    --warn-bg: #3a2a0a;  --warn: #ffc46b;
    --error-bg: #3b1214; --error: #ff9b9b;
    --dev: #ff6b6b;                /* the development login frame */
  }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; background: var(--bg);
         color: var(--text); margin: 0; padding: 2rem 1rem; }
  main { max-width: 28rem; margin-inline: auto; background: var(--surface); border-radius: 12px;
         padding: 1.5rem; border: 1px solid var(--border); }
  a { color: var(--link); }
  a:visited { color: var(--link-visited); }
  :focus-visible { outline: 2px solid var(--green-focus); outline-offset: 2px; }
  h1 { margin-block-start: 0; font-size: 1.5rem; }
  .button, .button:visited { display: block; text-align: center; background: var(--green); color: #fff;
            border: 0; border-radius: 8px; padding: 0.9rem; font: inherit;
            font-weight: 600; text-decoration: none; width: 100%; box-sizing: border-box;
            cursor: pointer; }
  .hint { color: var(--muted); font-size: 0.9rem; }
  .error { background: var(--error-bg); color: var(--error); border-radius: 8px; padding: 0.8rem;
           font-weight: 600; }
  fieldset { border: 1px dashed var(--dev); border-radius: 8px; margin-block-start: 2rem; }
  legend { color: var(--dev); font-weight: 600; }
  input, select, textarea { background: var(--raised); color: var(--text);
                            border: 1px solid var(--border); border-radius: 6px; }
  input { font: inherit; padding: 0.5rem; width: 100%; box-sizing: border-box;
          margin-block: 0.3rem 0.6rem; }
  select { font: inherit; padding: 0.3rem; }
  main.wide { max-width: 46rem; }
  .ok { background: var(--ok-bg); color: var(--ok); border-radius: 8px; padding: 0.8rem;
        font-weight: 600; }
  .warn { background: var(--warn-bg); color: var(--warn); border-radius: 8px; padding: 0.8rem;
          font-weight: 600; }
  .gifts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
           gap: 0.75rem; }
  .gift { border: 2px solid var(--border); border-radius: 10px; padding: 0.9rem;
          display: flex; flex-direction: column; gap: 0.4rem; }
  .gift.out { opacity: 0.5; }
  .gift img, .photo { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 6px;
                      background: var(--raised); }
  .photo { max-width: 16rem; display: block; }
  img.register { width: 100%; height: auto; display: block; border-radius: 8px; }
  .gift strong { font-size: 1.1rem; }
  .big { font-size: 1.5rem; font-weight: 700; margin: 0.3rem 0; }
  .button.disabled { background: #3f4247; color: var(--muted); cursor: default; }
  .button.secondary, .button.secondary:visited { background: var(--raised); color: var(--text);
                      border: 1px solid var(--border); margin-block-start: 0.5rem; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .bar form .button { width: auto; padding: 0.4rem 0.9rem; }
  .button.small { width: auto; padding: 0.4rem 0.9rem; margin: 0; }
  form.inline { display: flex; gap: 0.5rem; align-items: center; }
  form.inline input { width: 6rem; margin: 0; }
  .card { border: 1px solid var(--border); border-radius: 10px; padding: 1rem;
          margin-block: 1rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1rem; }
  dt { color: var(--muted); }
  dd { margin: 0; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border-block-end: 1px solid var(--border); padding: 0.4rem; text-align: start; }
  section { margin-block-start: 1.5rem; }
  fieldset.question { border: 1px solid var(--border); border-radius: 10px; margin-block-end: 1rem; }
  fieldset.question legend { color: var(--text); font-weight: 600; padding-inline: 0.3rem; }
  .option { display: block; padding-block: 0.3rem; }
  .option input { width: auto; margin-inline-end: 0.4rem; }
  .option .follow { width: 60%; margin-block: 0; font: inherit; padding: 0.3rem; }
  /* A follow-up shows only once its own option is picked. CSS only, no JavaScript. */
  .option input:not(:checked) ~ .follow { display: none; }
  .when { display: none; margin-block-start: 0.5rem; }
  .extra-toggle { font-weight: 600; margin-block-end: 1rem; }
  .extra { display: none; }
  form:has(.extra-toggle input:checked) .extra { display: block; }
  textarea { font: inherit; width: 100%; box-sizing: border-box; padding: 0.5rem; }
</style>
</head>
<body><main${wide ? ' class="wide"' : ""}>${body}</main></body>
</html>`;
}

/** Request 24: the student login page, the default at /. */
export function loginPage(options: { devLogin: boolean; error?: StudentRefusal }): string {
  const error = options.error ? `<p class="error">${T.refused[options.error]}</p>` : "";
  const dev = options.devLogin
    ? `<fieldset>
  <legend>${T.devTitle}</legend>
  <form method="post" action="/auth/dev">
    <label>${T.devStudent}<input name="national_id" dir="ltr" inputmode="numeric" placeholder="100000002"></label>
    <button class="button" name="kind" value="student">${T.devGo}</button>
  </form>
</fieldset>`
    : "";
  return layout(`<h1>${T.title}</h1>
${error}
<a class="button" href="/auth/google">${T.signIn}</a>
<p><a href="/staff/login">${T.staffLink}</a></p>
${dev}`);
}

/** Request 24: the staff login page, for managers and workers. */
export function staffLoginPage(options: { devLogin: boolean; error?: StaffRefusal }): string {
  const error = options.error ? `<p class="error">${T.staffRefused[options.error]}</p>` : "";
  const dev = options.devLogin
    ? `<fieldset>
  <legend>${T.devTitle}</legend>
  <form method="post" action="/auth/dev">
    <label>${T.devStaff}<input name="email" dir="ltr" placeholder="dev@aguda.org.il"></label>
    <button class="button" name="kind" value="staff">${T.devGo}</button>
  </form>
</fieldset>`
    : "";
  return layout(`<h1>${T.staffLoginTitle}</h1>
${error}
<a class="button" href="/auth/google/staff">${T.staffSignIn}</a>
<p><a href="/">${T.studentLink}</a></p>
${dev}`);
}

/** An imperative, not a verbal noun: התנתק, not התנתקות. Gendered for a known woman. */
const logoutForm = (gender: string | null = null) =>
  `<form method="post" action="/auth/logout"><button class="button secondary">${isFemale(gender) ? T.logoutFemale : T.logout}</button></form>`;

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

/** Staff: this student selected no gift, so hand nothing over. */
export const noSelectionText = (gender: string | null) =>
  isFemale(gender) ? T.staff.noSelectionFemale : T.staff.noSelection;

/** A student-page error, in the feminine form for a known woman when one exists. */
export const studentErrorText = (reason: StudentError, gender: string | null) =>
  (isFemale(gender) && T.student.errorsFemale[reason]) || T.student.errors[reason];

/** Staff: this student is not a member now, so do not hand the gift over. */
export const lapsedText = (gender: string | null) =>
  isFemale(gender) ? T.staff.lapsedFemale : T.staff.lapsed;

// ---- student ---------------------------------------------------------------------------

export type Notice = { kind: "ok" | "error" | "warn"; text: string };
const notice = (n?: Notice) => (n ? `<p class="${n.kind}">${n.text}</p>` : "");

export function studentPage(s: StudentView, gifts: GiftView[], message?: Notice): string {
  const f = isFemale(s.gender);
  const head = `<div class="bar"><h1>${esc(s.first_name)} ${esc(s.last_name)}</h1>${logoutForm(s.gender)}</div>
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
    const lapsed = s.member !== true ? `<p class="warn">${f ? T.student.lapsedFemale : T.student.lapsed}</p>` : "";
    return layout(`${head}
<div class="card"><p>${T.student.yourGift}</p><p class="big">${esc(s.gift_name)}</p>
<p class="hint">${f ? T.student.chooseHintFemale : T.student.chooseHint}</p>${lapsed}
<p>${f ? T.student.collectHintFemale : T.student.collectHint}</p>
${s.member === true ? `<a class="button secondary" href="/student/received">${f ? T.student.markReceivedFemale : T.student.markReceived}</a>` : ""}</div>`);
  }

  // No selection, and not a member: nothing to choose. A non-member sees how to register
  // instead (request 37). The image opens at full size, so a phone can zoom in.
  if (s.member !== true) {
    if (s.member === null) {
      return layout(`${head}<p class="warn">${f ? T.student.unknownMemberFemale : T.student.unknownMember}</p>`);
    }
    return layout(`${head}<p class="warn">${f ? T.student.notMemberFemale : T.student.notMember}</p>
<p>${f ? T.student.registerFemale : T.student.register}</p>
<a href="/img/how_to_register.jpg" target="_blank"><img class="register" src="/img/how_to_register.jpg" alt="${T.student.registerAlt}"></a>`);
  }

  // A member with no selection: the gifts. A sold-out gift cannot be chosen (request 19).
  const cards = gifts
    .map((g) =>
      g.selectable > 0
        ? `<div class="gift">${photo(g)}<strong>${esc(g.name)}</strong><span class="hint">${esc(g.description)}</span>
<a class="button" href="/student/confirm?gift=${g.id}">${isFemale(s.gender) ? T.student.selectFemale : T.student.select}</a></div>`
        : `<div class="gift out">${photo(g)}<strong>${esc(g.name)}</strong><span class="hint">${esc(g.description)}</span>
<span class="button disabled" aria-disabled="true">${T.student.soldOut}</span></div>`,
    )
    .join("\n");
  return layout(`${head}
<h2>${T.student.choose}</h2>
<p class="hint">${f ? T.student.chooseHintFemale : T.student.chooseHint}</p>
<div class="gifts">${cards}</div>`);
}

/**
 * Request 22. Shown instead of the gifts until the student submits it. On an error, the
 * page comes back with every answer the student gave, so nothing has to be typed twice.
 */
export function surveyPage(
  s: StudentView,
  survey: Survey,
  state: { values?: Record<string, unknown>; errors?: Record<string, "required" | "invalid"> } = {},
): string {
  const female = isFemale(s.gender);
  const values = state.values ?? {};
  const has = (q: Question, v: string) => {
    const raw = values[q.id];
    return Array.isArray(raw) ? raw.map(String).includes(v) : raw === v;
  };

  /** A text box or a dropdown after an option. CSS hides it until the option is picked. */
  const followUp = (q: Question, o: Option): string => {
    if (!o.follow) return "";
    const key = followKey(q.id, o.follow);
    if (o.follow.kind === "text") {
      return ` <input type="text" class="follow" name="${esc(key)}" maxlength="1000" value="${esc(values[key])}">`;
    }
    if (o.follow.kind === "multi") {
      const picked = new Set((Array.isArray(values[key]) ? values[key] : [values[key]]).map(String));
      return `<div class="choices">${o.follow.options
        .map((x) => `<label class="option"><input type="checkbox" name="${esc(key)}" value="${esc(x.value)}"${picked.has(x.value) ? " checked" : ""}> ${esc((female && x.labelFemale) || x.label)}</label>`)
        .join("")}</div>`;
    }
    const groups = o.follow.groups
      .map((g) => `<optgroup label="${esc(g.label)}">${g.options
        .map((x) => `<option value="${esc(x.value)}"${values[key] === x.value ? " selected" : ""}>${esc(x.label)}</option>`)
        .join("")}</optgroup>`)
      .join("");
    return ` <select class="follow" name="${esc(key)}"><option value="">${female ? T.survey.pickFemale : T.survey.pick}</option>${groups}</select>`;
  };

  /**
   * Aguda's general links for everyone, then the links of each of the student's campuses
   * (request 27). A campus listed without WhatsApp invites the student to start a group.
   */
  const links = (q: Question): string => {
    if (!q.campusSocial) return "";
    const a = (href: string, text: string) =>
      `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    const line = (parts: (string | false | undefined)[]) => {
      const kept = parts.filter(Boolean);
      return kept.length ? `<p class="hint">${kept.join(" · ")}</p>` : "";
    };
    const all: Social = AGUDA_SOCIAL;
    let out = line([all.instagram && a(all.instagram, T.survey.instagramAll), all.whatsapp && a(all.whatsapp, T.survey.whatsappAll)]);
    for (const name of s.campuses) {
      const c = CAMPUS_SOCIAL[name];
      if (!c) continue;
      const campus = esc(name);
      out += line([
        c.instagram && a(c.instagram, `${T.survey.instagram} ${campus}`),
        c.whatsapp
          ? a(c.whatsapp, `${T.survey.whatsapp} ${campus}`)
          : `${T.survey.noWhatsapp} ${campus}. ${female ? T.survey.startOneFemale : T.survey.startOne}`,
      ]);
    }
    return out;
  };

  const field = (q: Question) => {
    const label = (female && q.labelFemale) || q.label;
    const mark = q.required ? ` <span class="hint">(${T.survey.required})</span>` : "";
    const error = state.errors?.[q.id] ? `<p class="error">${(female ? T.survey.errorsFemale : T.survey.errors)[state.errors[q.id]]}</p>` : "";
    let input: string;
    if (q.kind === "text") {
      input = `<textarea name="${esc(q.id)}" rows="3" maxlength="1000">${esc(values[q.id])}</textarea>`;
    } else if (q.kind === "choice" && q.dropdown) {
      const options = q.options
        .map((o) => `<option value="${esc(o.value)}"${has(q, o.value) ? " selected" : ""}>${esc((female && o.labelFemale) || o.label)}</option>`)
        .join("");
      input = `<select name="${esc(q.id)}"><option value="">${female ? T.survey.pickFemale : T.survey.pick}</option>${options}</select>`;
      // A dropdown option's follow-up sits after the box. CSS shows it only while that
      // option is selected, with no JavaScript.
      for (const o of q.options.filter((x) => x.follow)) {
        input += `<div class="when" data-when="${esc(o.value)}">${followUp(q, o)}</div>
<style>.question:has(select[name="${esc(q.id)}"] option[value="${esc(o.value)}"]:checked) .when[data-when="${esc(o.value)}"] { display: block; }</style>`;
      }
    } else {
      const type = q.kind === "choice" ? "radio" : "checkbox";
      input = q.options
        .map((o) => {
          const optionLabel = (female && o.labelFemale) || o.label;
          return `<label class="option"><input type="${type}" name="${esc(q.id)}" value="${esc(o.value)}"${has(q, o.value) ? " checked" : ""}> ${esc(optionLabel)}${followUp(q, o)}</label>`;
        })
        .join("");
    }
    return `<fieldset class="question"><legend>${esc(label)}${mark}</legend>${links(q)}${error}${input}</fieldset>`;
  };

  // The extra questions come last, inside a section a checkbox opens; CSS shows and hides
  // it. Unchecking clears every extra answer: the small script does it on the page, and
  // validate() ignores extra answers sent while the box is unchecked, so a browser without
  // JavaScript stores nothing either. The box starts checked when the student already
  // answered an extra question, or one has an error, so nothing the student must see stays
  // hidden.
  const main = survey.questions.filter((q) => !q.extra);
  const extra = survey.questions.filter((q) => q.extra);
  const answered = (q: Question) =>
    values[EXTRA_FIELD] === "1" &&
    (state.errors?.[q.id] !== undefined || (values[q.id] !== undefined && values[q.id] !== ""));
  const extraSection = extra.length
    ? `<label class="option extra-toggle"><input type="checkbox" name="${EXTRA_FIELD}" value="1"${extra.some(answered) ? " checked" : ""} onchange="if (!this.checked) for (const e of this.form.querySelectorAll('.extra input, .extra select, .extra textarea')) { if (e.type === 'checkbox' || e.type === 'radio') e.checked = false; else if (e.tagName === 'SELECT') e.selectedIndex = 0; else e.value = ''; }"> ${female ? T.survey.extraFemale : T.survey.extra} <span class="hint">(${T.survey.optional})</span></label>
<div class="extra">
${extra.map(field).join("\n")}
</div>`
    : "";
  const fields = `${main.map(field).join("\n")}\n${extraSection}`;

  return layout(`<div class="bar"><h1>${T.survey.title}</h1>${logoutForm(s.gender)}</div>
<p>${female ? T.survey.introFemale : T.survey.intro}</p>
<form method="post" action="/student/survey">
${fields}
<button class="button">${female ? T.survey.submitFemale : T.survey.submit}</button>
</form>`);
}

/** The gift's photo, if it has one. The name beside it serves as the text alternative. */
const photo = (g: GiftView, cls = "") =>
  g.image ? `<img${cls ? ` class="${cls}"` : ""} src="/img/${encodeURIComponent(g.image)}" alt="" loading="lazy">` : "";

/**
 * Request 26. The student marks the gift as received. It cannot be undone, and it stops
 * the desk from handing the gift over, so it takes a second, explicit step.
 */
export function receivedConfirmPage(s: StudentView): string {
  const f = isFemale(s.gender);
  return layout(`<h1>${T.student.receivedTitle}</h1>
<p class="big">${esc(s.gift_name)}</p>
<p class="warn">${f ? T.student.receivedWarnFemale : T.student.receivedWarn}</p>
<form method="post" action="/student/received">
  <button class="button">${f ? T.student.confirmReceivedFemale : T.student.confirmReceived}</button>
</form>
<a class="button secondary" href="/student">${f ? T.student.backFemale : T.student.back}</a>`);
}

/** The selection is final (request 3), so it takes a second, explicit step. */
export function confirmPage(gift: GiftView, gender: string | null): string {
  const female = isFemale(gender);
  return layout(`<h1>${T.student.confirmTitle}</h1>
${photo(gift, "photo")}
<p class="big">${esc(gift.name)}</p>
<p class="warn">${female ? T.student.confirmFinalFemale : T.student.confirmFinal}</p>
<form method="post" action="/student/select">
  <input type="hidden" name="gift_id" value="${gift.id}">
  <button class="button">${female ? T.student.confirmFemale : T.student.confirm}</button>
</form>
<a class="button secondary" href="/student">${female ? T.student.backFemale : T.student.back}</a>`);
}

// ---- staff -----------------------------------------------------------------------------

function studentCard(s: StudentView, giftNames: Map<number, string>): string {
  let action = "";
  const f = isFemale(s.gender);
  if (s.gift_id === null) action = `<p class="warn">${noSelectionText(s.gender)}</p>`;
  else if (s.gift_taken_at) action = "";
  else if (s.member !== true) action = `<p class="error">${lapsedText(s.gender)}</p>`;
  else {
    // The national ID travels in the POST body, never in a URL (plan §12).
    action = `<form method="post" action="/staff/take">
  <input type="hidden" name="national_id" value="${esc(s.national_id)}">
  <button class="button">${T.staff.markTaken}</button>
</form>`;
  }

  // Request 30: let the student start again. Never after the handout (gifts.ts).
  const resetForm = (what: "gift" | "all", label: string) => `<form method="post" action="/staff/reset">
  <input type="hidden" name="national_id" value="${esc(s.national_id)}">
  <input type="hidden" name="what" value="${what}">
  <button class="button secondary">${label}</button>
</form>`;
  const reset = s.gift_taken_at
    ? ""
    : (s.gift_id !== null ? resetForm("gift", T.staff.resetGift) : "") +
      (s.gift_id !== null || s.survey_submitted
        ? resetForm("all", s.gift_id !== null ? T.staff.resetAll : T.staff.resetSurvey)
        : "");

  const history = s.interactions.length
    ? `<h3>${T.staff.history}</h3><ul>${s.interactions
        .map((i) => `<li>${when(i.at)} ${i.type === "gift_collection_reversed" ? T.staff.collectionReversed : T.staff.collected} ${esc(giftNames.get(i.gift_id!) ?? i.gift_id)}</li>`)
        .join("")}</ul>`
    : "";

  return `<div class="card">
<h2>${esc(s.first_name)} ${esc(s.last_name)}</h2>
<dl>
  <dt>${T.staff.nationalId}</dt><dd>${ltr(s.national_id)}</dd>
  <dt>${T.staff.membership}</dt><dd>${memberLabel(s.member, s.gender)} <span class="hint">${T.staff.updated} ${when(s.member_changed_at)}</span></dd>
  <dt>${T.staff.gift}</dt><dd>${s.gift_name ? esc(s.gift_name) : "—"}</dd>
  <dt>${T.staff.status}</dt><dd>${s.gift_taken_at ? `${f ? T.staff.takenAtFemale : T.staff.takenAt} ${when(s.gift_taken_at)}` : f ? T.staff.notTakenFemale : T.staff.notTaken}</dd>
</dl>
${action}
${reset}
${history}
</div>`;
}

/** Request 30: deleting cannot be undone, so it takes a second, explicit step. */
export function resetConfirmPage(s: StudentView, what: "gift" | "all"): string {
  const f = isFemale(s.gender);
  const warn = what === "gift"
    ? f ? T.staff.resetGiftWarnFemale : T.staff.resetGiftWarn
    : f ? T.staff.resetAllWarnFemale : T.staff.resetAllWarn;
  return layout(`<h1>${T.staff.resetTitle}</h1>
<p class="big">${esc(s.first_name)} ${esc(s.last_name)}</p>
<p>${ltr(s.national_id)}${s.gift_name ? ` · ${esc(s.gift_name)}` : ""}</p>
<p class="warn">${warn}</p>
<form method="post" action="/staff/reset">
  <input type="hidden" name="national_id" value="${esc(s.national_id)}">
  <input type="hidden" name="what" value="${what}">
  <input type="hidden" name="confirm" value="1">
  <button class="button">${T.staff.resetConfirm}</button>
</form>
<a class="button secondary" href="/staff">${T.staff.back}</a>`);
}

export function staffPage(options: {
  email: string;
  role: Role;
  stats: StaffStats;
  student?: StudentView | null;
  searched?: boolean;
  message?: Notice;
}): string {
  const { email, role, stats, student, searched, message } = options;
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
    `<div class="bar"><h1>${T.staff.title}</h1><span class="hint">${ltr(email)}</span>${logoutForm()}</div>
${role !== "worker" ? `<p><a href="/manager">${T.staff.manage}</a></p>` : ""}
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

// ---- manager (request 24) ----------------------------------------------------------------

/** Request 40: the ceo's list of every gift selection, with a reversal for each handout. */
export function selectionsPage(options: { email: string; rows: SelectionView[]; message?: Notice }): string {
  const { email, rows, message } = options;
  const M = T.manager;
  const body = rows
    .map((r) => `<tr><td>${esc(r.first_name)} ${esc(r.last_name)}</td><td>${ltr(r.national_id)}</td><td>${esc(r.gift_name)}</td><td>${
      r.gift_taken_at ? `${M.receivedAt} ${when(r.gift_taken_at)}` : M.selected
    }</td><td>${
      r.gift_taken_at
        ? `<form method="post" action="/manager/gifts/unmark">
  <input type="hidden" name="national_id" value="${esc(r.national_id)}">
  <button class="button secondary small">${M.unmark}</button>
</form>`
        : ""
    }</td></tr>`)
    .join("");
  return layout(
    `<div class="bar"><h1>${M.selectionsTitle}</h1><span class="hint">${ltr(email)}</span>${logoutForm()}</div>
<p><a href="/manager">${M.title}</a></p>
${notice(message)}
${rows.length
  ? `<table><thead><tr>${M.selectionsCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`
  : `<p class="hint">${M.selectionsNone}</p>`}`,
    true,
  );
}

/** Request 40: a reversal lets a desk hand the gift over again, so it takes a second step. */
export function unmarkConfirmPage(s: StudentView): string {
  const M = T.manager;
  return layout(`<h1>${M.unmarkTitle}</h1>
<p class="big">${esc(s.first_name)} ${esc(s.last_name)}</p>
<p>${ltr(s.national_id)} · ${esc(s.gift_name)} · ${M.receivedAt} ${when(s.gift_taken_at)}</p>
<p class="warn">${isFemale(s.gender) ? M.unmarkWarnFemale : M.unmarkWarn}</p>
<form method="post" action="/manager/gifts/unmark">
  <input type="hidden" name="national_id" value="${esc(s.national_id)}">
  <input type="hidden" name="confirm" value="1">
  <button class="button">${M.unmarkConfirm}</button>
</form>
<a class="button secondary" href="/manager/gifts">${T.staff.back}</a>`);
}

export function managerPage(options: {
  email: string;
  role: Role;
  /** Request 33: whether students see the survey's extra questions. */
  extraQuestions: boolean;
  /** Request 35: staff removed after 5 wrong IDs, shown to a ceo until cleared. */
  alerts: { at: string; email: string; role: string }[];
  staff: { email: string; role: Role }[];
  gifts: GiftView[];
  message?: Notice;
}): string {
  const { email, role, extraQuestions, alerts, staff, gifts, message } = options;
  const M = T.manager;
  // Request 32: only roles below the viewer's own.
  const roleOptions = (["worker", "manager", "ceo"] as const)
    .filter((r) => mayManage(role, r))
    .map((r) => `<option value="${r}">${M.roles[r]}</option>`)
    .join("");
  const alertBox = role === "ceo" && alerts.length
    ? `<div class="error"><ul>${alerts
        .map((a) => `<li>${M.alertRemoved} ${ltr(a.email)} (${esc(M.roles[a.role as Role] ?? a.role)}) ${M.alertReason} <span class="hint">${when(a.at)}</span></li>`)
        .join("")}</ul>
<form method="post" action="/manager/alerts/clear">
  <input type="hidden" name="up_to" value="${esc(alerts[alerts.length - 1].at)}">
  <button class="button secondary small">${M.alertsClear}</button>
</form></div>`
    : "";
  const selectionsLink = role === "ceo" ? `<p><a href="/manager/gifts">${M.selections}</a></p>` : "";
  const extraSwitch = role === "ceo"
    ? `<section><h2>${M.extraTitle}</h2>
<p class="${extraQuestions ? "ok" : "warn"}">${extraQuestions ? M.extraIsOn : M.extraIsOff}</p>
<form method="post" action="/manager/extra-questions">
  <input type="hidden" name="enabled" value="${extraQuestions ? "0" : "1"}">
  <button class="button${extraQuestions ? " secondary" : ""}">${extraQuestions ? M.extraTurnOff : M.extraTurnOn}</button>
</form>
</section>`
    : "";
  const downloads = role === "ceo"
    ? `<section><h2>${M.export}</h2>
<p class="hint">${M.exportHint}</p>
${(Object.keys(M.exportTables) as (keyof typeof M.exportTables)[])
  .map((t) => `<a class="button secondary" href="/manager/export/${t}.csv" download>${M.exportTables[t]}</a>`)
  .join("\n")}
</section>`
    : "";

  // Request 25: one list of all the staff, with each person's role. A remove button only
  // where this viewer may remove (request 32): strictly below their own level.
  const staffRows = staff
    .map(
      (m) => `<tr><td>${ltr(m.email)}</td><td>${M.roles[m.role]}</td><td>${
        mayManage(role, m.role) && m.email !== email
          ? `<form method="post" action="/manager/staff/remove">
  <input type="hidden" name="email" value="${esc(m.email)}">
  <button class="button secondary small">${M.remove}</button>
</form>`
          : ""
      }</td></tr>`,
    )
    .join("");

  const stockRows = gifts
    .map(
      (g) => `<tr><td>${esc(g.name)}</td><td>${ltr(g.requested_count)}</td><td>${ltr(g.given_count)}</td><td>
<form method="post" action="/manager/stock" class="inline">
  <input type="hidden" name="gift_id" value="${g.id}">
  <input name="starting_inventory" value="${g.starting_inventory}" dir="ltr" inputmode="numeric" aria-label="${M.stockCols[3]} ${esc(g.name)}">
  <button class="button small">${M.save}</button>
</form></td></tr>`,
    )
    .join("");

  return layout(
    `<div class="bar"><h1>${M.title}</h1><span class="hint">${ltr(email)}</span>${logoutForm()}</div>
<p><a href="/staff">${M.back}</a></p>
${selectionsLink}
${alertBox}
${notice(message)}
<section><h2>${M.staff}</h2>
<table><thead><tr>${M.staffCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${staffRows}</tbody></table>
<p class="hint">${M.managersHint}</p>
<form method="post" action="/manager/staff/add">
  <label>${M.newStaff}<input name="email" type="email" dir="ltr" autocomplete="off" required></label>
  <label>${M.role} <select name="role">${roleOptions}</select></label>
  <button class="button">${M.add}</button>
</form>
</section>
<section><h2>${M.stock}</h2>
<p class="hint">${M.stockHint}</p>
<table><thead><tr>${M.stockCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${stockRows}</tbody></table>
</section>
${extraSwitch}
${downloads}`,
    true,
  );
}
