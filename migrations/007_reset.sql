-- Request 30. Staff can delete a selection, so requested_count now also goes down. The
-- plan (§4.2) said to add this check when that happens. Dropped and added again on every
-- run, so the file stays idempotent.
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_requested_not_negative;
ALTER TABLE gifts ADD CONSTRAINT gifts_requested_not_negative CHECK (requested_count >= 0);
