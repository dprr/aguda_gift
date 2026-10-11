-- The photo of each gift: a file name in img/, served at /img/<file>.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS image text;
