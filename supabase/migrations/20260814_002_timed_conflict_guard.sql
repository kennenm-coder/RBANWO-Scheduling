-- Transaction-safe scheduling conflict guard.
-- Serializes writes per assigned resource, then checks helpers, inclusive
-- multi-day ranges, full-day work, and timed interval overlap.

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

  IF NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'SCHEDULING_CONFLICT: a scheduled appointment requires a valid start and end time';
  END IF;

  new_resources := ARRAY_REMOVE(
    ARRAY[NEW.crew_id, NEW.secondary_crew_id, NEW.tertiary_crew_id]::uuid[],
    NULL
  );

  -- BEFORE triggers cannot see concurrent uncommitted rows. These locks force
  -- competing writes for the same resource to validate serially.
  -- Stable ordering avoids deadlocks when two appointments contain the same
  -- resources in different primary/helper positions.
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

DROP TRIGGER IF EXISTS trg_check_timed_overlap ON sched_appointments;
DROP TRIGGER IF EXISTS trg_check_scheduler_resource_conflict ON sched_appointments;

CREATE TRIGGER trg_check_scheduler_resource_conflict
  BEFORE INSERT OR UPDATE OF
    crew_id, secondary_crew_id, tertiary_crew_id, scheduled_date,
    start_time, end_time, time_block, duration_days, status
  ON sched_appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_scheduler_resource_conflict();

COMMENT ON FUNCTION check_scheduler_resource_conflict() IS
  'Serializes resource writes and rejects primary/helper, timed/full-day, and multi-day conflicts.';
