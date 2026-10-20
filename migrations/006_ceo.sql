-- Request 29. A third staff role: ceo (מנכ"ל), a manager who can also download the data.
-- Dropped and added again on every run, so the file stays idempotent.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('worker', 'manager', 'ceo'));
