-- Intentional same-slot overlap (conflict-override on rForce approval).
--
-- Two guards prevent double-booking a crew:
--   1. UNIQUE index idx_no_double_book (crew_id, scheduled_date, time_block)
--   2. BEFORE-trigger check_scheduler_resource_conflict (handles helpers,
--      timed/full-day overlap, multi-day ranges) — the stricter guard.
--
-- To let a scheduler intentionally place a second appointment in a slot a crew
-- is already booked for, we tag that appointment with allow_overlap = true and
-- make BOTH guards skip it. Only the OVERRIDING appointment carries the flag;
-- the original stays fully guarded, so a normal (non-override) appointment can
-- still never silently double-book.

ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS allow_overlap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sched_appointments.allow_overlap IS
  'True when a scheduler intentionally overlapped this appointment into an already-booked slot via the conflict-override flow. Skipped by idx_no_double_book and check_scheduler_resource_conflict.';

-- Guard 1: exclude overlap-allowed rows from the uniqueness index.
DROP INDEX IF EXISTS idx_no_double_book;
CREATE UNIQUE INDEX idx_no_double_book
  ON sched_appointments(crew_id, scheduled_date, time_block)
  WHERE status NOT IN ('cancelled', 'unscheduled') AND allow_overlap = false;

-- Guard 2: teach the resource-conflict trigger to skip overlap-allowed rows.
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

  -- BEFORE triggers cannot see concurrent uncommitted rows. These locks force
  -- competing writes for the same resource to validate serially.
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
      existing.time_block = 'full_day'
      OR NEW.time_block = 'full_day'
      OR (NEW.start_time < existing.end_time AND NEW.end_time > existing.start_time)
    )
  LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SCHEDULING_CONFLICT: resource is already assigned to appointment %', conflict_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
