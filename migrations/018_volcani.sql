-- Request 68. מכון וולקני: a sub-campus of רחובות with its own stock, which a student
-- picks (src/campus.ts, PICK_SUB_CAMPUSES). Every רחובות student picks רחובות or מכון וולקני.

-- The places a student can collect at: their campuses, and the picked sub-campuses of
-- those campuses. More than one means the student must pick (chosen_campus). The list
-- repeats PICK_SUB_CAMPUSES in src/campus.ts.
CREATE OR REPLACE FUNCTION pickup_options(campuses text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT campuses || CASE WHEN 'רחובות' = ANY(campuses) THEN ARRAY['מכון וולקני'] ELSE '{}'::text[] END
$$;

-- The ceo's report: every student who had to pick, so the רחובות students too.
CREATE OR REPLACE VIEW multi_campus_gifts AS
  SELECT s.national_id, s.first_name, s.last_name,
         array_to_string(s.campuses, ' + ') AS campuses,
         s.pickup_campus, s.stock_campus, g.name AS gift, s.gift_taken_at AS received_at
    FROM students s JOIN gifts g ON g.id = s.gift_id
   WHERE cardinality(pickup_options(s.campuses)) > 1;
