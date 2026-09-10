-- Clear stale "book anyway" (allow_overlap) tags — OPTIONAL data cleanup.
--
-- Why: a row tagged allow_overlap skips BOTH the double-booking index and the
-- resource-conflict trigger on every later write. Two things left that tag on
-- rows that no longer deserve it:
--   * 20260827_001 bulk-set allow_overlap = true on every repaired tech_measure.
--   * Until phase 1 of the 2026-09-09 scheduling audit, the tag survived
--     unschedule → re-place and duration extensions.
-- Those rows have been unguarded ever since.
--
-- What this does: resets the tag on ACTIVE rows that do NOT currently overlap
-- any other active row for the same resource(s). Rows that genuinely share a
-- slot keep their tag — that overlap was approved, and clearing it would make
-- the next edit of either row fail.
--
-- Safe: the conflict trigger does not fire on allow_overlap changes, and a row
-- with no overlap cannot violate the double-booking index. Idempotent.

BEGIN;

WITH overlapping AS (
  SELECT DISTINCT a.id
  FROM sched_appointments a
  JOIN sched_appointments b
    ON b.id <> a.id
   AND b.status NOT IN ('cancelled', 'unscheduled')
   AND b.scheduled_date IS NOT NULL
   AND ARRAY_REMOVE(ARRAY[a.crew_id, a.secondary_crew_id, a.tertiary_crew_id]::uuid[], NULL)
       && ARRAY_REMOVE(ARRAY[b.crew_id, b.secondary_crew_id, b.tertiary_crew_id]::uuid[], NULL)
   AND daterange(
         a.scheduled_date,
         a.scheduled_date + GREATEST(COALESCE(a.duration_days, 1), 1),
         '[)'
       ) && daterange(
         b.scheduled_date,
         b.scheduled_date + GREATEST(COALESCE(b.duration_days, 1), 1),
         '[)'
       )
   AND (
         COALESCE(a.is_full_day, false)
         OR COALESCE(b.is_full_day, false)
         OR (a.start_time < b.end_time AND a.end_time > b.start_time)
       )
  WHERE a.allow_overlap
    AND a.status NOT IN ('cancelled', 'unscheduled')
    AND a.scheduled_date IS NOT NULL
)
UPDATE sched_appointments a
SET allow_overlap = false
WHERE a.allow_overlap
  AND a.status NOT IN ('cancelled', 'unscheduled')
  AND a.id NOT IN (SELECT id FROM overlapping);

COMMIT;
