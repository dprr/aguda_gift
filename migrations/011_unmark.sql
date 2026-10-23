-- Request 40. A ceo can reverse a handout, so given_count now also goes down. Dropped and
-- added again on every run, so the file stays idempotent.
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_given_not_negative;
ALTER TABLE gifts ADD CONSTRAINT gifts_given_not_negative CHECK (given_count >= 0);
