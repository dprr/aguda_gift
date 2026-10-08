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
- **A feminine form about a known woman** is correct Hebrew, not new-speak. Only the
  generic, unknown-person case uses the masculine.

## Check before finishing

`test/hebrew-text.test.ts` scans `src/` and `web/` and fails on any slash, dot, middle-dot,
or parenthesis form between Hebrew letters. Run `npm test` after editing Hebrew text. If
the test flags a legitimate non-gendered use, rewrite the text rather than weakening the
test.
