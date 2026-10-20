-- Request 34. Wrong national IDs a staff member searched in a row at the desk. The fifth
-- removes the person from the staff list; a successful search resets it to 0.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS failed_lookups integer NOT NULL DEFAULT 0;
