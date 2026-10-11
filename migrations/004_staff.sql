-- Requests 24 and 25. Every employee, in one list: managers and workers. Managers add and
-- remove workers on the manager page. A manager is added with `src/staff.ts`, from the
-- command line. Stored in lowercase, as login compares it.
CREATE TABLE IF NOT EXISTS staff (
  email text PRIMARY KEY CHECK (email = lower(email)),
  role  text NOT NULL CHECK (role IN ('manager', 'worker'))
);

-- The first version of request 24 kept workers in their own table. Move them, once.
DO $$
BEGIN
  IF to_regclass('workers') IS NOT NULL THEN
    INSERT INTO staff (email, role) SELECT email, 'worker' FROM workers ON CONFLICT DO NOTHING;
    DROP TABLE workers;
  END IF;
END $$;
