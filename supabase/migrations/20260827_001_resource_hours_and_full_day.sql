-- Resource hours + explicit full-day flag, and repair of the `time_block='full_day'`
-- corruption that made timed jobs (services/JIPs) block a crew's entire day.
--
-- Background: historically every queue-dropped / time-less job was stamped
-- time_block='full_day' + 08:00-16:00. For a *timed* type that made the row (a)
-- render as an all-day bar and (b) trip the "blocks the whole day" branch of the
-- resource-conflict guard, so nothing else could be booked on that crew/day.
--
-- New model:
--   • is_full_day  — the authoritative "occupies the whole day" flag. Installs/LSWP
--     are full-day; timed types never are. Replaces the time_block='full_day' hack
--     as the whole-day blocking signal in the trigger.
--   • resource_hours — how many hours the job occupies (mirrors end-start for timed
--     work; derived from the block for measures; NULL for full-day work).
--   • time_block stays the placement key for measures (9-10 … 4-6) and for genuine
--     full-day installs ('full_day'); it is NEVER 'full_day' on a timed type again.

BEGIN;

-- The repair rewrites start/end/time_block on rows that currently coexist with
-- their own victims, so re-running the resource-conflict guard mid-repair would
-- (correctly) reject them. Suspend it for this transaction; step 6 drops and
-- recreates it fresh at the end.
ALTER TABLE sched_appointments DISABLE TRIGGER trg_check_scheduler_resource_conflict;

-- ── 1. Columns ────────────────────────────────────────────────────────────────
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS resource_hours numeric NULL,
  ADD COLUMN IF NOT EXISTS is_full_day boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sched_appointments.resource_hours IS
  'Hours the job occupies the calendar. Mirrors end_time-start_time for timed work; block-duration for measures; NULL for full-day work.';
COMMENT ON COLUMN sched_appointments.is_full_day IS
  'Authoritative all-day flag. Whole-day blocking signal for the resource-conflict trigger. Installs/LSWP true; timed types always false.';

-- ── 2. Seed is_full_day for genuinely full-day work ───────────────────────────
UPDATE sched_appointments
SET is_full_day = true
WHERE status NOT IN ('cancelled')
  AND (
    (time_block = 'full_day' AND appointment_type IN ('install','lswp'))
    OR COALESCE(duration_days, 1) > 1
  );

-- ── 3. Repair TIMED types (service/jip/hoa/job_site_visit/paint_stain) tagged full_day ──
-- 3a. Real sub-day window already present → just drop the bogus tag and record hours.
UPDATE sched_appointments
SET time_block = NULL,
    is_full_day = false,
    resource_hours = ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0)::numeric, 2)
WHERE time_block = 'full_day'
  AND appointment_type IN ('service','jip','hoa','job_site_visit','paint_stain')
  AND status NOT IN ('cancelled')
  AND NOT (start_time = TIME '08:00' AND end_time = TIME '16:00');

-- 3b. Stuck at the 08:00-16:00 all-day default (no real time ever known) →
--     collapse to a 1-hour placeholder at 08:00 so it stops blocking the whole day.
--     (These rows are surfaced in the hand-off report for a scheduler to verify.)
UPDATE sched_appointments
SET time_block = NULL,
    is_full_day = false,
    start_time = TIME '08:00',
    end_time = TIME '09:00',
    resource_hours = 1
WHERE time_block = 'full_day'
  AND appointment_type IN ('service','jip','hoa','job_site_visit','paint_stain')
  AND status NOT IN ('cancelled')
  AND start_time = TIME '08:00' AND end_time = TIME '16:00';

-- ── 4. Repair MEASURES tagged full_day → snap to the block for their start hour ──
-- These are all-day-defaulted measures (some stacked 3-deep on one tech/day), so
-- they can collide on idx_no_double_book(crew,date,time_block) once snapped to a
-- block. Mark them allow_overlap so the index skips them; they are past-dated
-- history and are surfaced in the hand-off report for a scheduler to re-slot.
UPDATE sched_appointments
SET is_full_day = false,
    allow_overlap = true,
    time_block_end = NULL,
    time_block = CASE
      WHEN EXTRACT(HOUR FROM start_time) < 10 THEN '9-10'
      WHEN EXTRACT(HOUR FROM start_time) < 12 THEN '10-12'
      WHEN EXTRACT(HOUR FROM start_time) < 14 THEN '12-2'
      WHEN EXTRACT(HOUR FROM start_time) < 16 THEN '2-4'
      ELSE '4-6' END,
    start_time = CASE
      WHEN EXTRACT(HOUR FROM start_time) < 10 THEN TIME '09:00'
      WHEN EXTRACT(HOUR FROM start_time) < 12 THEN TIME '10:00'
      WHEN EXTRACT(HOUR FROM start_time) < 14 THEN TIME '12:00'
      WHEN EXTRACT(HOUR FROM start_time) < 16 THEN TIME '14:00'
      ELSE TIME '16:00' END,
    end_time = CASE
      WHEN EXTRACT(HOUR FROM start_time) < 10 THEN TIME '10:00'
      WHEN EXTRACT(HOUR FROM start_time) < 12 THEN TIME '12:00'
      WHEN EXTRACT(HOUR FROM start_time) < 14 THEN TIME '14:00'
      WHEN EXTRACT(HOUR FROM start_time) < 16 THEN TIME '16:00'
      ELSE TIME '18:00' END,
    resource_hours = CASE
      WHEN EXTRACT(HOUR FROM start_time) < 10 THEN 1 ELSE 2 END
WHERE time_block = 'full_day'
  AND appointment_type = 'tech_measure'
  AND status NOT IN ('cancelled');

-- ── 5. Backfill resource_hours for remaining timed appointments (informational) ──
UPDATE sched_appointments
SET resource_hours = ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0)::numeric, 2)
WHERE resource_hours IS NULL
  AND is_full_day = false
  AND time_block IS NULL
  AND start_time IS NOT NULL AND end_time IS NOT NULL
  AND end_time > start_time
  AND status NOT IN ('cancelled');

-- ── 6. Teach the resource-conflict guard to block whole days by is_full_day ─────
--     (was: time_block = 'full_day' — which fired for the corrupted timed rows).
CREATE OR REPLACE FUNCTION check_scheduler_resource_conflict()
RETURNS TRIGGER AS $$
DECLARE
  resource_id uuid;
  new_resources uuid[];
  conflict_id uuid;
BEGIN
  IF NEW.status IN ('cancelled', 'unscheduled')
     OR NEW.crew_id IS NULL
     OR NEW.scheduled_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Intentional same-slot overlap approved via the conflict-override flow.
  IF COALESCE(NEW.allow_overlap, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'SCHEDULING_CONFLICT: a scheduled appointment requires a valid start and end time';
  END IF;

  new_resources := ARRAY_REMOVE(
    ARRAY[NEW.crew_id, NEW.secondary_crew_id, NEW.tertiary_crew_id]::uuid[],
    NULL
  );

  SELECT ARRAY_AGG(candidate ORDER BY candidate)
    INTO new_resources
  FROM UNNEST(new_resources) AS candidate;
  FOREACH resource_id IN ARRAY new_resources LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(resource_id::text, 0));
  END LOOP;

  SELECT existing.id INTO conflict_id
  FROM sched_appointments existing
  WHERE existing.id <> NEW.id
    AND existing.status NOT IN ('cancelled', 'unscheduled')
    AND existing.scheduled_date IS NOT NULL
    AND ARRAY_REMOVE(
          ARRAY[existing.crew_id, existing.secondary_crew_id, existing.tertiary_crew_id]::uuid[],
          NULL
        ) && new_resources
    AND daterange(
          existing.scheduled_date,
          existing.scheduled_date + GREATEST(COALESCE(existing.duration_days, 1), 1),
          '[)'
        ) && daterange(
          NEW.scheduled_date,
          NEW.scheduled_date + GREATEST(COALESCE(NEW.duration_days, 1), 1),
          '[)'
        )
    AND (
      COALESCE(existing.is_full_day, false)
      OR COALESCE(NEW.is_full_day, false)
      OR (NEW.start_time < existing.end_time AND NEW.end_time > existing.start_time)
    )
  LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SCHEDULING_CONFLICT: resource is already assigned to appointment %', conflict_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-fire the guard when is_full_day toggles.
DROP TRIGGER IF EXISTS trg_check_scheduler_resource_conflict ON sched_appointments;
CREATE TRIGGER trg_check_scheduler_resource_conflict
  BEFORE INSERT OR UPDATE OF
    crew_id, secondary_crew_id, tertiary_crew_id, scheduled_date,
    start_time, end_time, time_block, duration_days, status, is_full_day
  ON sched_appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_scheduler_resource_conflict();

COMMIT;
