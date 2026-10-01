-- Partial helper days: a helper crew can cover part of a multi-day job.
--
-- Until now every crew on an appointment — lead and helpers alike — was booked
-- for the whole span, because the guard compared one daterange per ROW. A helper
-- brought in for day 2 of a 3-day install was therefore busy all three days.
--
-- Model: two new day lists, 0-based positions in the span (day 1 = 0).
--   NULL (the default)  -> the whole span, exactly as before. No backfill needed.
--   {1}                 -> day 2 only.
--   {0,2}               -> days 1 and 3, skipping day 2. Non-contiguous is normal:
--                          the scheduler picks days by clicking day tiles.
-- Positions rather than dates so a helper's days follow the job when it moves
-- instead of being stranded on dates the job no longer touches.
--
-- Degenerate lists fall back to the WHOLE span rather than freeing the crew: an
-- empty list, or one whose every entry sits outside the span (a job shortened
-- under a helper booked for its old last day). Never silently unbook someone.
-- src/lib/crew-days.ts is the client mirror of these rules and must agree.
--
-- The guard is otherwise identical to 20260929_001: time sanity first, remote
-- rows exempt on both sides, allow_overlap honoured after the sanity check.
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE; trigger recreated).

BEGIN;

-- ── Columns ───────────────────────────────────────────────────────────────────
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS secondary_day_offsets int[],
  ADD COLUMN IF NOT EXISTS tertiary_day_offsets  int[];

COMMENT ON COLUMN sched_appointments.secondary_day_offsets IS
  '0-based day positions in the span that the secondary crew works. NULL = the whole span.';
COMMENT ON COLUMN sched_appointments.tertiary_day_offsets IS
  '0-based day positions in the span that the tertiary crew works. NULL = the whole span.';

-- ── (crew, date) expansion ────────────────────────────────────────────────────
-- One row per crew per day that crew actually stands on the job. The lead is
-- always every day; helpers follow their day list. This is the single definition
-- of "who is busy when" that the guard reasons about.
CREATE OR REPLACE FUNCTION sched_crew_days(
  p_crew_id           uuid,
  p_secondary_crew_id uuid,
  p_tertiary_crew_id  uuid,
  p_secondary_days    int[],
  p_tertiary_days     int[],
  p_scheduled_date    date,
  p_duration_days     int
)
RETURNS TABLE (crew_id uuid, work_date date)
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH span AS (
    SELECT GREATEST(COALESCE(p_duration_days, 1), 1) AS days
  ),
  members AS (
    -- The lead owns every day of the span, whatever a stale list might say.
    SELECT p_crew_id AS crew_id, NULL::int[] AS days
      WHERE p_crew_id IS NOT NULL
    UNION ALL
    SELECT p_secondary_crew_id, p_secondary_days
      WHERE p_secondary_crew_id IS NOT NULL
    UNION ALL
    SELECT p_tertiary_crew_id, p_tertiary_days
      WHERE p_tertiary_crew_id IS NOT NULL
  )
  SELECT m.crew_id, p_scheduled_date + d
  FROM members m
  CROSS JOIN span s
  CROSS JOIN generate_series(0, s.days - 1) AS d
  WHERE p_scheduled_date IS NOT NULL
    AND (
      m.days IS NULL
      -- Nothing in the list survives inside the span -> treat as the whole span.
      OR NOT EXISTS (
        SELECT 1 FROM unnest(m.days) AS o WHERE o >= 0 AND o < s.days
      )
      OR d = ANY(m.days)
    )
$fn$;

-- ── Guard ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_scheduler_resource_conflict()
RETURNS TRIGGER AS $fn$
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

  -- A scheduled row must always carry a real forward window — even when the
  -- scheduler has approved an intentional overlap. Checked before allow_overlap.
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: a scheduled appointment requires an end time after its start time';
  END IF;

  -- A remote measure occupies none of the tech's day: it stacks on the remote
  -- row and never collides with anything.
  IF NEW.time_block = 'remote' THEN
    RETURN NEW;
  END IF;

  -- Intentional same-slot overlap approved via the conflict-override flow.
  IF COALESCE(NEW.allow_overlap, false) THEN
    RETURN NEW;
  END IF;

  new_resources := ARRAY_REMOVE(
    ARRAY[NEW.crew_id, NEW.secondary_crew_id, NEW.tertiary_crew_id]::uuid[],
    NULL
  );

  -- BEFORE triggers cannot see concurrent uncommitted rows. These locks force
  -- competing writes for the same resource to validate serially. Every crew on
  -- the row is locked, whatever days it works — two writes narrowing different
  -- helpers of the same crew still have to queue up behind each other.
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
    -- The other side of the exemption: an existing remote measure never blocks
    -- the on-site work booked around it.
    AND existing.time_block IS DISTINCT FROM 'remote'
    -- Cheap pre-filters on the row: a shared crew somewhere, and overlapping
    -- spans. Neither is sufficient now that crews carry their own days, but both
    -- keep the scan off rows that cannot possibly collide.
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
    -- The precise test: the SAME crew standing on the SAME day on both sides.
    -- Overlapping spans alone would flag a helper on a day it isn't there.
    AND EXISTS (
      SELECT 1
      FROM sched_crew_days(
             NEW.crew_id, NEW.secondary_crew_id, NEW.tertiary_crew_id,
             NEW.secondary_day_offsets, NEW.tertiary_day_offsets,
             NEW.scheduled_date, NEW.duration_days
           ) AS n
      JOIN sched_crew_days(
             existing.crew_id, existing.secondary_crew_id, existing.tertiary_crew_id,
             existing.secondary_day_offsets, existing.tertiary_day_offsets,
             existing.scheduled_date, existing.duration_days
           ) AS e
        ON e.crew_id = n.crew_id
       AND e.work_date = n.work_date
    )
  LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SCHEDULING_CONFLICT: resource is already assigned to appointment %', conflict_id;
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- The day lists are placement: narrowing one has to be re-judged, so they join
-- the UPDATE OF list. Without them, editing only a helper's days skips the guard.
DROP TRIGGER IF EXISTS trg_check_scheduler_resource_conflict ON sched_appointments;
CREATE TRIGGER trg_check_scheduler_resource_conflict
  BEFORE INSERT OR UPDATE OF
    crew_id, secondary_crew_id, tertiary_crew_id,
    secondary_day_offsets, tertiary_day_offsets, scheduled_date,
    start_time, end_time, time_block, duration_days, status, is_full_day
  ON sched_appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_scheduler_resource_conflict();

COMMIT;
