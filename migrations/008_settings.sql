-- Request 33. Site settings that a ceo changes on the website. Exactly one row: the
-- primary key can only be true.
CREATE TABLE IF NOT EXISTS settings (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  extra_questions boolean NOT NULL DEFAULT true   -- the survey's optional extra questions
);
INSERT INTO settings DEFAULT VALUES ON CONFLICT DO NOTHING;
