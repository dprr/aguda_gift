-- Request 56. The ceos are a fixed list (CEO_EMAILS in .env), not rows: nobody adds or
-- removes a ceo. The staff table holds workers and managers only.
DELETE FROM staff WHERE role = 'ceo';
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('worker', 'manager'));
