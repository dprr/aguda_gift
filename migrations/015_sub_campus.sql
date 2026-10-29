-- Request 55. Sub-campuses of עין כרם with their own gift stock (src/campus.ts).

-- The stock may now belong to a campus or a sub-campus. Dropped and added again on every
-- run, so the file stays idempotent.
ALTER TABLE gift_stock DROP CONSTRAINT IF EXISTS gift_stock_campus_check;
ALTER TABLE gift_stock ADD CONSTRAINT gift_stock_campus_check
  CHECK (campus IN ('גבעת רם', 'הר הצופים', 'עין כרם', 'רחובות', 'אסף הרופא', 'קפלן', 'ריפוי בעיסוק'));

-- The student's sub-campus, set by the loader from their tracks or faculty; usually null.
ALTER TABLE students ADD COLUMN IF NOT EXISTS sub_campus text;

-- The stock a student selects from: the sub-campus, or else the true campus. Computed by
-- the database, so it always agrees with the two.
ALTER TABLE students ADD COLUMN IF NOT EXISTS stock_campus text
  GENERATED ALWAYS AS (coalesce(sub_campus, campuses[1])) STORED;
