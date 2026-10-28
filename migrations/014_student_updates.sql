-- Request 54. Every update of the student list, with a simple summary, for the ceo's
-- update page. One row per sync that wrote, written in the sync's own transaction.
CREATE TABLE IF NOT EXISTS student_updates (
  id              serial      PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  source          text        NOT NULL,   -- upload, file, or schedule
  by_email        text,                   -- the ceo, for an upload
  received        integer     NOT NULL,   -- students in the list
  added           integer     NOT NULL,   -- new students
  removed         integer     NOT NULL,   -- members absent from the list: membership ended
  restored        integer     NOT NULL,   -- non-members on the list again: membership back
  profile_changed integer     NOT NULL    -- students whose details changed
);
