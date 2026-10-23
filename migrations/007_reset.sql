-- Request 30. Staff can delete a selection, so requested_count now also goes down. The
-- plan (§4.2) said to add this check when that happens. Since request 41 the counters live
-- in gift_stock (012), so this runs only while gifts still has the column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gifts' AND column_name = 'requested_count') THEN
    ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_requested_not_negative;
    ALTER TABLE gifts ADD CONSTRAINT gifts_requested_not_negative CHECK (requested_count >= 0);
  END IF;
END $$;
