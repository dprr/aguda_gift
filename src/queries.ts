/** Reads for the two interfaces. Every write lives in gifts.ts and sync.ts. */
import { pool } from "./db.ts";
import { counterDrift } from "./gifts.ts";

export type StudentView = {
  national_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  /**
   * Request 41: the student's one campus, the first of students.campuses. Every rule uses
   * this; the full list is not read here, so nothing can use it by mistake (request 43).
   */
  true_campus: string | null;
  member: boolean | null;
  member_changed_at: Date | null;
  gift_id: number | null;
  gift_name: string | null;
  gift_taken_at: Date | null;
  interactions: { at: string; type: string; gift_id?: number }[];
  /** Request 22. The student may not select a gift until this is true. */
  survey_submitted: boolean;
};

export async function findStudent(nationalId: string): Promise<StudentView | null> {
  const r = await pool.query(
    `SELECT s.national_id, s.first_name, s.last_name, s.gender, s.true_campus, s.member,
            s.member_changed_at, s.gift_id, g.name AS gift_name, s.gift_taken_at,
            s.interactions, s.survey IS NOT NULL AS survey_submitted
       FROM students s LEFT JOIN gifts g ON g.id = s.gift_id
      WHERE s.national_id = $1`,
    [nationalId],
  );
  return r.rows[0] ?? null;
}

/** Request 40: every student with a gift selection, for the ceo. Received first, newest first. */
export type SelectionView = {
  national_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  gift_name: string;
  true_campus: string | null;
  gift_taken_at: Date | null;
};

export async function listSelections(): Promise<SelectionView[]> {
  const r = await pool.query(
    `SELECT s.national_id, s.first_name, s.last_name, s.gender, g.name AS gift_name, s.true_campus, s.gift_taken_at
       FROM students s JOIN gifts g ON g.id = s.gift_id
      ORDER BY s.gift_taken_at DESC NULLS LAST, g.id, s.last_name, s.first_name`,
  );
  return r.rows;
}

/** Request 41: one gift's stock on one campus. */
export type GiftView = {
  id: number;
  campus: string;
  name: string;
  description: string;
  /** A file name in img/, or null if the gift has no photo. */
  image: string | null;
  starting_inventory: number;
  requested_count: number;
  given_count: number;
  /** How many more students may select it. Plan §4.2. */
  selectable: number;
  /** Units still physically in the box. Plan §4.2. */
  in_box: number;
};

/** The gifts with their stock on `campus`, or on every campus when `campus` is null. */
export async function listGifts(campus: string | null): Promise<GiftView[]> {
  const r = await pool.query(
    `SELECT g.id, k.campus, g.name, g.description, g.image,
            k.starting_inventory, k.requested_count, k.given_count,
            k.starting_inventory - k.requested_count AS selectable,
            k.starting_inventory - k.given_count     AS in_box
       FROM gifts g JOIN gift_stock k ON k.gift_id = g.id
      WHERE $1::text IS NULL OR k.campus = $1
      ORDER BY k.campus, g.id`,
    [campus],
  );
  return r.rows;
}

/** The gift names by id, whatever the campus: for history lines. */
export async function giftNames(): Promise<Map<number, string>> {
  const r = await pool.query("SELECT id, name FROM gifts");
  return new Map(r.rows.map((g) => [g.id, g.name]));
}

export type StaffStats = {
  gifts: GiftView[];
  names: Map<number, string>;
  drift: Awaited<ReturnType<typeof counterDrift>>;
};

/** The stock of one campus, or of every campus for a ceo (campus null). */
export async function staffStats(campus: string | null): Promise<StaffStats> {
  const [gifts, names, drift] = await Promise.all([listGifts(campus), giftNames(), counterDrift()]);
  return { gifts, names, drift: drift.filter((d) => campus === null || d.campus === campus) };
}
