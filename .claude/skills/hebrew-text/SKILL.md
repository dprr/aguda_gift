---
name: hebrew-text
description: Use whenever writing, editing, or reviewing any Hebrew text in this project — UI strings, messages, page content, comments, seed data, or test data. Enforces the owner's rule against gendered "new-speak" forms such as סטודנט/ית.
---

# Hebrew text

## The rule

**Never use gendered new-speak forms. Use the masculine form as the neutral form.**

This is the owner's explicit decision. It has no exceptions, and it applies to every Hebrew
string in the repository.

| Never write | Write |
|---|---|
| סטודנט/ית | סטודנט |
| סטודנטים/ות | סטודנטים |
| חבר/ת אגודה | חבר אגודה |
| לא חבר/ת | לא חבר |
| נכנס/ת | נכנס |
| פנה/י | פנה |
| סטודנט.ית, סטודנטים.ות | סטודנט, סטודנטים |
| סטודנט·ית | סטודנט |
| סטודנט(ית) | סטודנט |
| סטודנטיות וסטודנטים | סטודנטים |

Forbidden in every spelling: a slash, a dot, a middle dot (·), or parentheses that attach a
feminine ending to a word. Also forbidden: writing both forms side by side to avoid choosing.

## What stays allowed

- **The infinitive** is not gendered, so it needs no change: "נא לנסות שוב", "נא לפנות
  למשרד האגודה". Do not rewrite an infinitive into a masculine imperative just to apply
  this rule.
- **A feminine form about a known woman** is correct Hebrew, not new-speak, and it is
  **required**. Only the generic, unknown-person case uses the masculine.

## When the text is about one known student

The student page and the staff card show one specific student, and `students.gender` holds
that student's gender. So these texts must follow it:

- `isFemale(gender)` in `src/pages.ts` decides. A gender code it does not recognise counts
  as unknown, which gives the masculine.
- Write both forms in `T`, as a pair: `member` and `memberFemale`, `notMember` and
  `notMemberFemale`. Never join them with a slash.
- Text about students in general stays masculine plural: "רק חברי אגודה יכולים".
- Many second-person verbs are spelled the same for both: בחרת, קיבלת, אינך. They need no
  pair.

## Address one student, in the singular

The owner's rule. Text that speaks to the student uses the singular, gendered form, not
the plural אתם as a way to avoid choosing:

| Never write | Man, or gender unknown | Woman |
|---|---|---|
| מה אתם חושבים | מה אתה חושב | מה את חושבת |
| האם אתם צופים | האם אתה צופה | האם את צופה |

Give the feminine form as `labelFemale`. Words spelled the same for both, such as שלך,
צופה, בחרת, need no pair.

## Buttons use the imperative, never a verbal noun

The owner's rule. A button is an instruction to the user, so it uses the active
imperative form.

| Never write | Write | Female form, when the gender is known |
|---|---|---|
| התנתקות | התנתק | התנתקי |
| התחברות | התחבר | — (gender unknown before login) |
| כניסה | היכנס | — |
| בחירה | בחר | בחרי |
| אישור הבחירה | אשר את הבחירה | אשרי את הבחירה |
| חזרה | חזור | חזרי |
| חיפוש | חפש | — (staff have no stored gender) |
| סימון המתנה כנמסרה | סמן כנמסרה | — |

- On the student pages the gender is known, so write both forms in `T` as a pair, such as
  `select` and `selectFemale`, and choose with `isFemale()`.
- On the login page and the staff page the gender is unknown, so use the masculine.
- **Headings and field labels stay nouns.** "בחירת מתנה" as a title, or "חיפוש סטודנט" as a
  field label, names a thing; it does not instruct. Only buttons and links that act take
  the imperative.

## Check before finishing

`test/hebrew-text.test.ts` scans `src/` and fails on any slash, dot, middle-dot,
or parenthesis form between Hebrew letters. Run `npm test` after editing Hebrew text. If
the test flags a legitimate non-gendered use, rewrite the text rather than weakening the
test.
