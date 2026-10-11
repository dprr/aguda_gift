-- Request 24. The workers that managers added on the manager page. Managers are not
-- here: they come from MANAGERS in .env. Stored in lowercase, as login compares it.
CREATE TABLE IF NOT EXISTS workers (
  email text PRIMARY KEY CHECK (email = lower(email))
);
