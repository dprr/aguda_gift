-- Request 22: a survey every student submits before selecting a gift.
-- Null means not submitted. Once set it never changes: submitted is final.
--   {"version": 1, "submitted_at": "...", "answers": {"question_id": "value", ...}}
ALTER TABLE students ADD COLUMN IF NOT EXISTS survey jsonb;
