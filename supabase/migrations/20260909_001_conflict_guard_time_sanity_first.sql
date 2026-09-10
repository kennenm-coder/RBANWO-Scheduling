-- Resource-conflict guard: validate the time window BEFORE honouring allow_overlap.
--
-- Bug: the guard returned early for rows tagged allow_overlap, so an appointment
-- whose end_time was at or before its start_time was accepted as long as the
-- "book anyway" tag was set. Worse, the sanity check's own message started with
-- "SCHEDULING_CONFLICT:", so the app presented it as a double-book the scheduler
-- could override — and confirming saved the backwards window.
--
-- Fix: run the start < end check first, unconditionally, and raise it under its
-- own code (INVALID_TIME_RANGE) so the app shows a plain error with no override.
-- Everything else is identical to 20260827_001.
--
-- Safe to re-run (CREATE OR REPLACE; trigger dropped and recreated).

BEGIN;

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

  -- A scheduled row must always carry a real forward window — even when the
  -- scheduler has approved an intentional overlap. Checked before allow_overlap.
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: a scheduled appointment requires an end time after its start time';
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

DROP TRIGGER IF EXISTS trg_check_scheduler_resource_conflict ON sched_appointments;
CREATE TRIGGER trg_check_scheduler_resource_conflict
  BEFORE INSERT OR UPDATE OF
    crew_id, secondary_crew_id, tertiary_crew_id, scheduled_date,
    start_time, end_time, time_block, duration_days, status, is_full_day
  ON sched_appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_scheduler_resource_conflict();

COMMIT;
