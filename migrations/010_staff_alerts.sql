-- Request 35. Alerts for the ceo: each staff member removed after 5 wrong IDs in a row
-- (request 34), as {at, email, role}. The ceo's manager page shows them until cleared.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS staff_alerts jsonb NOT NULL DEFAULT '[]';
