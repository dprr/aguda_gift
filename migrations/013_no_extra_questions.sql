-- Request 53. The survey's extra questions are gone, and so is their on/off switch.
ALTER TABLE settings DROP COLUMN IF EXISTS extra_questions;
