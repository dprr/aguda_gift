-- Request 41. One gift stock per campus, staff per campus, and each student's true campus.

-- The first campus in the student's sorted list. Computed by the database, so it always
-- agrees with campuses. Null when the student has no campus.
ALTER TABLE students ADD COLUMN IF NOT EXISTS true_campus text GENERATED ALWAYS AS (campuses[1]) STORED;

-- The campus whose stock a selection took, so the counts stay right if true_campus changes.
ALTER TABLE students ADD COLUMN IF NOT EXISTS gift_campus text;

CREATE TABLE IF NOT EXISTS gift_stock (
  gift_id            integer NOT NULL REFERENCES gifts (id),
  campus             text    NOT NULL CHECK (campus IN ('גבעת רם', 'הר הצופים', 'עין כרם', 'רחובות')),
  starting_inventory integer NOT NULL,
  requested_count    integer NOT NULL DEFAULT 0,
  given_count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (gift_id, campus),
  CONSTRAINT stock_never_oversold CHECK (requested_count <= starting_inventory),
  CONSTRAINT stock_requested_not_negative CHECK (requested_count >= 0),
  CONSTRAINT stock_given_not_negative CHECK (given_count >= 0)
);

-- The counters now live per campus. The gifts table keeps the catalogue only.
ALTER TABLE gifts
  DROP COLUMN IF EXISTS starting_inventory,
  DROP COLUMN IF EXISTS requested_count,
  DROP COLUMN IF EXISTS given_count;

-- A worker or a manager belongs to one campus. A ceo has none: they see every campus.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS campus text;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_campus_check;
ALTER TABLE staff ADD CONSTRAINT staff_campus_check
  CHECK (campus IS NULL OR campus IN ('גבעת רם', 'הר הצופים', 'עין כרם', 'רחובות'));
