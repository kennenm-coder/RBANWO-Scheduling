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
-- What this does: resets the tag on ACTIVE rows that would NOT collide with any
-- other active row once un-tagged. A row keeps its tag when another active row:
--   (a) shares its EXACT (crew_id, scheduled_date, time_block) key — this is
--       what idx_no_double_book enforces, so clearing would raise 23505; or
--   (b) genuinely overlaps it by resource + date-range + full-day/timed window
--       (the resource-conflict trigger's logic) — a real intentional overlap.
-- Both checks are needed: (a) alone misses helper-crew / multi-day overlaps,
-- and (b) alone (the first version of this migration) missed same-block pairs
-- whose stored times don't line up — which DID collide on the index.
--
-- Safe: the trigger does not fire on an allow_overlap-only update, and by
-- construction no row that shares an index key with another is ever cleared,
-- so idx_no_double_book cannot be violated. Idempotent.

BEGIN;

UPDATE sched_appointments a
SET allow_overlap = false
WHERE a.allow_overlap
  AND a.status NOT IN ('cancelled', 'unscheduled')
  AND a.scheduled_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sched_appointments b
    WHERE b.id <> a.id
      AND b.status NOT IN ('cancelled', 'unscheduled')
      AND b.scheduled_date IS NOT NULL
      AND (
        -- (a) same double-booking index key → un-tagging would duplicate it
        (
          b.crew_id = a.crew_id
          AND b.scheduled_date = a.scheduled_date
          AND b.time_block IS NOT DISTINCT FROM a.time_block
        )
        OR
        -- (b) a genuine resource / date-range / window overlap
        (
          ARRAY_REMOVE(ARRAY[a.crew_id, a.secondary_crew_id, a.tertiary_crew_id]::uuid[], NULL)
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
        )
      )
  );

COMMIT;
