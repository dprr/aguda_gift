/**
 * Request 29. A ceo downloads the data, one CSV file per table. CSV opens in Excel and in
 * Google Sheets, and needs no library.
 *
 * - A UTF-8 byte order mark comes first, or Excel shows the Hebrew as garbage.
 * - A list or jsonb value (campuses, programs, membership_history, survey) goes into its
 *   cell as JSON text. A time goes in as ISO 8601, in UTC.
 * - A cell that starts with = + - @ gets a leading ' so a spreadsheet never runs it as a
 *   formula. Students write survey text, so a cell can hold anything.
 */
import { pool } from "./db.ts";

/** The tables a ceo can download, with their order. Never built from the request. */
export const EXPORTS = {
  students: "SELECT * FROM students ORDER BY national_id",
  gifts: "SELECT * FROM gifts ORDER BY id",
  staff: "SELECT * FROM staff ORDER BY email",
} as const;
export type ExportName = keyof typeof EXPORTS;

export const isExport = (name: string): name is ExportName => Object.hasOwn(EXPORTS, name);

function cell(value: unknown): string {
  let text =
    value === null || value === undefined ? ""
    : value instanceof Date ? value.toISOString()
    : typeof value === "object" ? JSON.stringify(value)
    : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportCsv(name: ExportName): Promise<string> {
  const r = await pool.query(EXPORTS[name]);
  const columns = r.fields.map((f) => f.name);
  const lines = [columns.map(cell).join(","), ...r.rows.map((row) => columns.map((c) => cell(row[c])).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
