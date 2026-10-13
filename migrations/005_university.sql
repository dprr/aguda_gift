-- Request 27. The real university list (orbitapi.huji.ac.il, AgudaStudents). A student
-- can study at several campuses, and in several programs, each with several tracks. So:
--
--   campuses  the university's campus names, sorted, for example {"הר הצופים","רחובות"}
--   programs  one entry per university record of the student, with the university's own
--             academic fields (faculty, program, year, roadMaps), sorted
--
-- They replace the single academic columns of 001, which held only invented data.
ALTER TABLE students ADD COLUMN IF NOT EXISTS campuses text[] NOT NULL DEFAULT '{}';
ALTER TABLE students ADD COLUMN IF NOT EXISTS programs jsonb  NOT NULL DEFAULT '[]';
ALTER TABLE students
  DROP COLUMN IF EXISTS faculty,
  DROP COLUMN IF EXISTS parent_faculty,
  DROP COLUMN IF EXISTS study_year,
  DROP COLUMN IF EXISTS campus,
  DROP COLUMN IF EXISTS program,
  DROP COLUMN IF EXISTS program_code,
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS department_code,
  DROP COLUMN IF EXISTS track,
  DROP COLUMN IF EXISTS track_code,
  DROP COLUMN IF EXISTS year_in_track,
  DROP COLUMN IF EXISTS track_scope;
