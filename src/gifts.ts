import { Rollback, pool, transaction } from "./db.ts";

export type SelectResult =
  | { ok: true; giftId: number }
  | {
      ok: false;
      reason: "unknown_student" | "not_member" | "already_selected" | "unknown_gift" | "sold_out";
    };

/**
 * Plan §5.1. A student selects a gift. The selection is final (request 3), and a sold-out
 * gift cannot be selected (request 19).
 *
 * Two guards in one transaction. Either one failing rolls back both, so a student never
 * holds a gift without a unit of stock, and a unit is never claimed without a student.
 */
export async function selectGift(nationalId: string, giftId: number): Promise<SelectResult> {
  return transaction(async (db) => {
    const gift = await db.query("SELECT 1 FROM gifts WHERE id = $1", [giftId]);
    if (gift.rowCount === 0) {
      throw new Rollback<SelectResult>({ ok: false, reason: "unknown_gift" });
    }

    // 1. Write-once. Runs first, so a retry or a double tap stops here and never
    //    touches the shared gifts row.
    const chose = await db.query(
      `UPDATE students SET gift_id = $2
        WHERE national_id = $1 AND member IS TRUE AND gift_id IS NULL`,
      [nationalId, giftId],
    );
    if (chose.rowCount === 0) {
      const row = await db.query(
        "SELECT member, gift_id FROM students WHERE national_id = $1",
        [nationalId],
      );
      const s = row.rows[0];
      const reason = !s ? "unknown_student" : s.gift_id !== null ? "already_selected" : "not_member";
      throw new Rollback<SelectResult>({ ok: false, reason });
    }

    // 2. The contended compare-and-swap. Every student meets on this one row.
    const claimed = await db.query(
      `UPDATE gifts SET requested_count = requested_count + 1
        WHERE id = $1 AND requested_count < starting_inventory`,
      [giftId],
    );
    if (claimed.rowCount === 0) {
      throw new Rollback<SelectResult>({ ok: false, reason: "sold_out" });
    }

    return { ok: true, giftId };
  });
}

export type TakeResult =
  | { ok: true; giftId: number; takenAt: Date }
  | { ok: false; reason: "unknown_student" | "no_selection" | "not_member" }
  | { ok: false; reason: "already_taken"; takenAt: Date };

/**
 * Plan §5.2. An employee marks the gift as taken. A guarded write: one desk wins, and every
 * later attempt gets `already_taken` (requests 5 and 8). The student must still be a member
 * (request 20). A lapsed member is refused, and the unit stays held.
 */
export async function markTaken(nationalId: string): Promise<TakeResult> {
  return transaction(async (db) => {
    const taken = await db.query(
      `UPDATE students
          SET gift_taken_at = now(),
              interactions = interactions || jsonb_build_array(jsonb_build_object(
                'at', now(), 'type', 'gift_collection', 'gift_id', gift_id))
        WHERE national_id = $1
          AND member IS TRUE
          AND gift_id IS NOT NULL
          AND gift_taken_at IS NULL
        RETURNING gift_id, gift_taken_at`,
      [nationalId],
    );

    if (taken.rowCount === 0) {
      const row = await db.query(
        "SELECT member, gift_id, gift_taken_at FROM students WHERE national_id = $1",
        [nationalId],
      );
      const s = row.rows[0];
      let result: TakeResult;
      if (!s) result = { ok: false, reason: "unknown_student" };
      else if (s.gift_taken_at) result = { ok: false, reason: "already_taken", takenAt: s.gift_taken_at };
      else if (s.gift_id === null) result = { ok: false, reason: "no_selection" };
      else result = { ok: false, reason: "not_member" };
      throw new Rollback(result);
    }

    const { gift_id, gift_taken_at } = taken.rows[0];
    await db.query("UPDATE gifts SET given_count = given_count + 1 WHERE id = $1", [gift_id]);
    return { ok: true, giftId: gift_id, takenAt: gift_taken_at };
  });
}

/**
 * Plan §4.2. The counters are stored, but `students` is the truth. Returns every gift whose
 * counter disagrees with the student rows. An empty list means no drift.
 */
export async function counterDrift(): Promise<
  { gift_id: number; counter: string; stored: number; actual: number }[]
> {
  const result = await pool.query(`
    SELECT g.id AS gift_id, 'requested_count' AS counter,
           g.requested_count AS stored, count(s.national_id)::int AS actual
      FROM gifts g LEFT JOIN students s ON s.gift_id = g.id
     GROUP BY g.id
    HAVING g.requested_count <> count(s.national_id)
    UNION ALL
    SELECT g.id, 'given_count', g.given_count, count(s.national_id)::int
      FROM gifts g LEFT JOIN students s ON s.gift_id = g.id AND s.gift_taken_at IS NOT NULL
     GROUP BY g.id
    HAVING g.given_count <> count(s.national_id)`);
  return result.rows;
}

/**
 * Request 20. Students who selected a gift, have not collected it, and are no longer
 * members. Each one holds a unit of stock that nobody else can select.
 */
export async function unitsHeldByNonMembers(): Promise<{ gift_id: number; held: number }[]> {
  const result = await pool.query(`
    SELECT gift_id, count(*)::int AS held
      FROM students
     WHERE gift_id IS NOT NULL AND gift_taken_at IS NULL AND member IS NOT TRUE
     GROUP BY gift_id ORDER BY gift_id`);
  return result.rows;
}
