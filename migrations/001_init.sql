-- Plan §4. Two tables.
--
-- Every migration file is idempotent and runs on every `npm run migrate`, in name order.
-- There is no tracking table: plan §0 allows two tables, and idempotent SQL needs none.

CREATE TABLE IF NOT EXISTS gifts (
  id                 integer PRIMARY KEY,
  name               text    NOT NULL,
  description        text    NOT NULL DEFAULT '',
  starting_inventory integer NOT NULL,             -- request 16. Set once, never changed
  requested_count    integer NOT NULL DEFAULT 0,   -- request 16. +1 per selection
  given_count        integer NOT NULL DEFAULT 0,   -- request 16. +1 per handout

  -- Request 19. The guard in §5.1 already enforces this. The constraint covers every
  -- other writer, such as a person editing a row by hand.
  CONSTRAINT gifts_never_oversold CHECK (requested_count <= starting_inventory)
);

CREATE TABLE IF NOT EXISTS students (
  national_id        text PRIMARY KEY,             -- request 9. Stored as given
  university_email   text UNIQUE,                  -- Google login matches on this. Lowercase

  -- §4.2 identity, request 17
  first_name         text,
  last_name          text,
  gender             text,
  phone              text,

  -- Requests 17 and 27. As the university list gives them; see 005_university.sql
  special_population text,
  campuses           text[] NOT NULL DEFAULT '{}',
  programs           jsonb  NOT NULL DEFAULT '[]',

  -- state
  member             boolean,                      -- null means unknown
  member_changed_at  timestamptz,
  gift_id            integer REFERENCES gifts (id),
  gift_taken_at      timestamptz,                  -- not null means handed over
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- append-only arrays
  membership_history jsonb NOT NULL DEFAULT '[]',  -- request 13
  interactions       jsonb NOT NULL DEFAULT '[]'   -- request 18
);
