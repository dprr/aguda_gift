/** Reads for the two interfaces. Every write lives in gifts.ts and sync.ts. */
import { pool } from "./db.ts";
import { counterDrift } from "./gifts.ts";

export type StudentView = {
  national_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  faculty: string | null;
  campus: string | null;
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
    `SELECT s.national_id, s.first_name, s.last_name, s.gender, s.faculty, s.campus, s.member,
            s.member_changed_at, s.gift_id, g.name AS gift_name, s.gift_taken_at,
            s.interactions, s.survey IS NOT NULL AS survey_submitted
       FROM students s LEFT JOIN gifts g ON g.id = s.gift_id
      WHERE s.national_id = $1`,
    [nationalId],
  );
  return r.rows[0] ?? null;
}

export type GiftView = {
  id: number;
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

export async function listGifts(): Promise<GiftView[]> {
  const r = await pool.query(
    `SELECT id, name, description, image, starting_inventory, requested_count, given_count,
            starting_inventory - requested_count AS selectable,
            starting_inventory - given_count     AS in_box
       FROM gifts ORDER BY id`,
  );
  return r.rows;
}

export type StaffStats = {
  gifts: GiftView[];
  drift: Awaited<ReturnType<typeof counterDrift>>;
};

export async function staffStats(): Promise<StaffStats> {
  const [gifts, drift] = await Promise.all([listGifts(), counterDrift()]);
  return { gifts, drift };
}
