// Enforces .claude/skills/hebrew-text: no gendered new-speak in Hebrew text. The masculine
// form is the neutral form: סטודנט, not סטודנט/ית.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const HEB = "\\u0590-\\u05FF";
// A Hebrew letter, then / or . or ·, then a Hebrew letter. Or a Hebrew letter, then a
// parenthesized Hebrew ending: סטודנט(ית).
const NEWSPEAK = new RegExp(`[${HEB}][/.·][${HEB}]|[${HEB}]\\([${HEB}]+\\)`, "u");

async function* files(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // web/ does not exist before M4
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist") yield* files(path);
    } else if (/\.(ts|tsx|html|css|json)$/.test(e.name)) yield path;
  }
}

test("no gendered new-speak forms in Hebrew text", async () => {
  const found: string[] = [];
  for (const dir of ["src", "web"]) {
    for await (const file of files(join(root, dir))) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (NEWSPEAK.test(line)) found.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(found, [], `use the masculine form as neutral:\n${found.join("\n")}`);
});

// An impersonal instruction: יש / אין / נא + an infinitive, or אפשר / אי אפשר. The
// owner's rule is the active voice: ענה, not יש לענות. A pronoun after ל is not an
// infinitive, so "אין לנו מידע" and "יש לך" stay allowed.
const L = "[\\u05D0-\\u05EA]";
const IMPERSONAL = new RegExp(
  `(^|[^\\u05D0-\\u05EA])(יש|אין|נא) ל(?!(נו|ך|כם|כן|ו|ה|י|הם|הן)(?!${L}))${L}+|אי אפשר|(^|[^\\u05D0-\\u05EA])אפשר ל${L}`,
  "u",
);

test("no impersonal instructions in Hebrew text: active voice only", async () => {
  const found: string[] = [];
  for (const dir of ["src", "web"]) {
    for await (const file of files(join(root, dir))) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (IMPERSONAL.test(line)) found.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(found, [], `write the active voice, for example ענה instead of יש לענות:\n${found.join("\n")}`);
});

test("the impersonal pattern catches what it must, and only that", () => {
  for (const bad of ["יש לענות על השאלה", "אין למסור", "נא לפנות למשרד", "אי אפשר לשנות", "אפשר לבחור"]) {
    assert.match(bad, IMPERSONAL, bad);
  }
  for (const good of ["אין לנו מידע", "יש לך שאלה", "אין קבוצת וואטסאפ", "ענה על השאלה", "אל תמסור את המתנה"]) {
    assert.doesNotMatch(good, IMPERSONAL, good);
  }
});

test("the pattern catches every forbidden spelling", () => {
  for (const bad of ["סטודנט/ית", "חבר/ת", "סטודנט.ית", "סטודנט·ית", "סטודנט(ית)"]) {
    assert.match(bad, NEWSPEAK, bad);
  }
  for (const good of ["סטודנט", "חבר אגודה", "נא לנסות שוב.", "mail.huji.ac.il"]) {
    assert.doesNotMatch(good, NEWSPEAK, good);
  }
});
