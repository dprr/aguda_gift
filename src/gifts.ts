import { Rollback, pool, transaction } from "./db.ts";

export type SelectResult =
  | { ok: true; giftId: number }
  | {
      ok: false;
      reason: "unknown_student" | "not_member" | "already_selected" | "unknown_gift" | "sold_out" | "survey_missing" | "no_campus";
    };

/**
 * Plan §5.1. A student selects a gift. The selection is final (request 3), and a sold-out
 * gift cannot be selected (request 19).
 *
 * Two guards in one transaction. Either one failing rolls back both, so a student never
 * holds a gift without a unit of stock, and a unit is never claimed without a student.
 *
 * Requests 41 and 55: the unit comes from the student's stock campus: their sub-campus, or
 * else their true campus. Students never move, so every later step uses the same stock.
 */
export async function selectGift(nationalId: string, giftId: number): Promise<SelectResult> {
  return transaction(async (db) => {
    const gift = await db.query("SELECT 1 FROM gifts WHERE id = $1", [giftId]);
    if (gift.rowCount === 0) {
      throw new Rollback<SelectResult>({ ok: false, reason: "unknown_gift" });
    }

    // 1. Write-once. Runs first, so a retry or a double tap stops here and never
    //    touches the shared stock row. The survey must be submitted first (request 22).
    const chose = await db.query(
      `UPDATE students SET gift_id = $2
        WHERE national_id = $1 AND member IS TRUE AND gift_id IS NULL AND survey IS NOT NULL
          AND stock_campus IS NOT NULL
        RETURNING stock_campus`,
      [nationalId, giftId],
    );
    if (chose.rowCount === 0) {
      const row = await db.query(
        "SELECT member, gift_id, survey IS NOT NULL AS surveyed, stock_campus FROM students WHERE national_id = $1",
        [nationalId],
      );
      const s = row.rows[0];
      const reason = !s
        ? "unknown_student"
        : s.gift_id !== null
          ? "already_selected"
          : !s.surveyed
            ? "survey_missing"
            : s.member !== true
              ? "not_member"
              : "no_campus";
      throw new Rollback<SelectResult>({ ok: false, reason });
    }

    // 2. The contended compare-and-swap. Every student of the campus meets on this row.
    const claimed = await db.query(
      `UPDATE gift_stock SET requested_count = requested_count + 1
        WHERE gift_id = $1 AND campus = $2 AND requested_count < starting_inventory`,
      [giftId, chose.rows[0].stock_campus],
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
        RETURNING gift_id, stock_campus, gift_taken_at`,
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

    const { gift_id, stock_campus, gift_taken_at } = taken.rows[0];
    await db.query(
      "UPDATE gift_stock SET given_count = given_count + 1 WHERE gift_id = $1 AND campus = $2",
      [gift_id, stock_campus],
    );
    return { ok: true, giftId: gift_id, takenAt: gift_taken_at };
  });
}

export type UnmarkResult = { ok: true } | { ok: false; reason: "unknown_student" | "not_taken" };

/**
 * Request 40. A ceo reverses a handout that should not have been recorded, for example a
 * student's mistaken "I received it". The selection stays, the gift's given_count goes
 * down by one, and the history gains a reversal entry; the collection entry stays, so the
 * history still shows what happened. The guard is in the WHERE clause, so a double click
 * reverses once.
 */
export async function unmarkTaken(nationalId: string): Promise<UnmarkResult> {
  return transaction(async (db) => {
    const r = await db.query(
      `UPDATE students
          SET gift_taken_at = NULL,
              interactions = interactions || jsonb_build_array(jsonb_build_object(
                'at', now(), 'type', 'gift_collection_reversed', 'gift_id', gift_id))
        WHERE national_id = $1 AND gift_taken_at IS NOT NULL
        RETURNING gift_id, stock_campus`,
      [nationalId],
    );
    if (!r.rowCount) {
      const exists = await db.query("SELECT 1 FROM students WHERE national_id = $1", [nationalId]);
      throw new Rollback<UnmarkResult>({ ok: false, reason: exists.rowCount ? "not_taken" : "unknown_student" });
    }
    await db.query(
      "UPDATE gift_stock SET given_count = given_count - 1 WHERE gift_id = $1 AND campus = $2",
      [r.rows[0].gift_id, r.rows[0].stock_campus],
    );
    return { ok: true };
  });
}

export type ResetResult =
  | { ok: true }
  | { ok: false; reason: "unknown_student" | "taken" | "nothing" };

/**
 * Request 30. Any staff member deletes a student's gift selection ("gift"), or the survey
 * answers and the selection ("all"), so the student can start again. The unit returns to
 * the stock.
 *
 * Never after the handout: the student could then select, and collect, a second gift.
 * The row lock makes this and a desk's markTaken() run one after the other, so a handout
 * and a deletion of the same selection can never both succeed.
 */
export async function resetStudent(nationalId: string, what: "gift" | "all"): Promise<ResetResult> {
  return transaction(async (db) => {
    const row = await db.query(
      "SELECT gift_id, stock_campus, gift_taken_at, survey IS NOT NULL AS surveyed FROM students WHERE national_id = $1 FOR UPDATE",
      [nationalId],
    );
    const s = row.rows[0];
    if (!s) return { ok: false, reason: "unknown_student" };
    if (s.gift_taken_at) return { ok: false, reason: "taken" };
    if (s.gift_id === null && (what === "gift" || !s.surveyed)) return { ok: false, reason: "nothing" };

    await db.query(
      `UPDATE students SET gift_id = NULL, survey = CASE WHEN $2 THEN NULL ELSE survey END
        WHERE national_id = $1`,
      [nationalId, what === "all"],
    );
    if (s.gift_id !== null) {
      await db.query(
        "UPDATE gift_stock SET requested_count = requested_count - 1 WHERE gift_id = $1 AND campus = $2",
        [s.gift_id, s.stock_campus],
      );
    }
    return { ok: true };
  });
}

/**
 * Plan §4.2. The counters are stored, but `students` is the truth. Returns every gift whose
 * counter disagrees with the student rows. An empty list means no drift.
 */
export async function counterDrift(): Promise<
  { gift_id: number; campus: string; counter: string; stored: number; actual: number }[]
> {
  // Request 41: one pair of counters per gift and campus, checked against the selections
  // of the students of that campus.
  const result = await pool.query(`
    SELECT k.gift_id, k.campus, 'requested_count' AS counter,
           k.requested_count AS stored, count(s.national_id)::int AS actual
      FROM gift_stock k LEFT JOIN students s ON s.gift_id = k.gift_id AND s.stock_campus = k.campus
     GROUP BY k.gift_id, k.campus
    HAVING k.requested_count <> count(s.national_id)
    UNION ALL
    SELECT k.gift_id, k.campus, 'given_count', k.given_count, count(s.national_id)::int
      FROM gift_stock k LEFT JOIN students s
        ON s.gift_id = k.gift_id AND s.stock_campus = k.campus AND s.gift_taken_at IS NOT NULL
     GROUP BY k.gift_id, k.campus
    HAVING k.given_count <> count(s.national_id)`);
  return result.rows;
}
