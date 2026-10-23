-- Request 40. A ceo can reverse a handout, so given_count now also goes down. Since
-- request 41 the counters live in gift_stock (012), so this runs only while gifts still
-- has the column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gifts' AND column_name = 'given_count') THEN
    ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_given_not_negative;
    ALTER TABLE gifts ADD CONSTRAINT gifts_given_not_negative CHECK (given_count >= 0);
  END IF;
END $$;
