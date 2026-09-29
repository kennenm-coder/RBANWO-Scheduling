-- Remote measures: the extra row above the 9-10 … 4-6 measure grid.
--
-- A measure the tech did remotely takes NONE of their on-site day. It is stored
-- as an ordinary tech_measure appointment with time_block = 'remote', so it keeps
-- a work order, a tech, a date, and its rForce link — but it must not behave like
-- a slot:
--
--   • Unlimited per tech/day. The tech can hold a full 9-10 … 4-6 schedule and
--     any number of remote measures on top of it.
--   • Never conflicts, in either direction. Not with an on-site block, not with
--     a full-day install, not with another remote measure.
--   • Occupies zero hours (resource_hours = 0, is_full_day = false).
--
-- It still carries a real forward window (08:00–08:30, the half hour before the
-- measure grid) because chk_scheduled_fields and the guard below both require
-- one; nothing reads it as a visit time. See src/lib/calendar-utils.ts
-- (REMOTE_BLOCK / REMOTE_WINDOW) for the app-side mirror of these rules.
--
-- Two DB guards have to learn about it:
--   1. UNIQUE idx_no_double_book (crew_id, scheduled_date, time_block) — would
--      allow only ONE remote measure per tech/day.
--   2. BEFORE-trigger check_scheduler_resource_conflict — judges overlap by the
--      stored window, so a second remote row would collide with the first.
--
-- Safe to re-run (CREATE OR REPLACE; index and trigger dropped and recreated).

BEGIN;

-- ── Guard 1: the remote row is not a slot, so it has no uniqueness ────────────
-- (Otherwise a tech's second remote measure of the day fails with 23505, which
-- the app reports as a double-book.)
DROP INDEX IF EXISTS idx_no_double_book;
CREATE UNIQUE INDEX idx_no_double_book
  ON sched_appointments(crew_id, scheduled_date, time_block)
  WHERE status NOT IN ('cancelled', 'unscheduled')
    AND allow_overlap = false
    AND time_block IS DISTINCT FROM 'remote';

-- ── Guard 2: remote rows neither block nor are blocked ────────────────────────
-- Identical to 20260909_001 apart from the two remote clauses. The time-sanity
-- check still runs first and unconditionally (see that migration).
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
    -- The other side of the exemption: an existing remote measure never blocks
    -- the on-site work booked around it.
    AND existing.time_block IS DISTINCT FROM 'remote'
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

-- ── Approving an rForce order onto the remote row ──────────────────────────────
-- Identical to 20260901_001 apart from v_resource_hours: a remote measure records
-- zero hours rather than the half hour its bookkeeping window happens to span.
CREATE OR REPLACE FUNCTION approve_rforce_order(
  p_crew_id uuid,
  p_appointment_type text,
  p_order_number text,
  p_work_order_number text,
  p_customer_name text,
  p_address text,
  p_scheduled_date text,
  p_start_time text,
  p_end_time text,
  p_time_block text,
  p_product_count integer,
  p_salesforce_url text,
  p_rforce_order_id text,
  p_actor_id text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_duration_days integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_appt sched_appointments%ROWTYPE;
  v_link sched_appointment_links%ROWTYPE;
  v_normalized_wo text := LOWER(TRIM(p_work_order_number));
  v_is_full_day boolean := COALESCE(p_time_block = 'full_day', false);
  v_resource_hours numeric := CASE
    WHEN p_time_block = 'full_day' THEN NULL
    WHEN p_time_block = 'remote' THEN 0
    WHEN p_start_time IS NULL OR p_end_time IS NULL THEN NULL
    ELSE ROUND((EXTRACT(EPOCH FROM (p_end_time::time - p_start_time::time)) / 3600.0)::numeric, 2)
  END;
BEGIN
  IF v_normalized_wo = '' THEN
    RAISE EXCEPTION 'DUPLICATE_WO: work order number is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wo:' || v_normalized_wo, 0));

  IF EXISTS (
    SELECT 1 FROM sched_appointments
    WHERE LOWER(TRIM(work_order_number)) = v_normalized_wo
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_WO: active appointment already exists for %', p_work_order_number;
  END IF;

  INSERT INTO sched_appointments (
    crew_id, secondary_crew_id, tertiary_crew_id, appointment_type,
    order_number, work_order_number, customer_name, address,
    scheduled_date, start_time, end_time, duration_days, time_block,
    is_full_day, resource_hours,
    status, notes, reschedule_reason, product_count, salesforce_url,
    scheduled_by, origin, sync_state
  ) VALUES (
    p_crew_id, NULL, NULL, p_appointment_type,
    p_order_number, TRIM(p_work_order_number), p_customer_name, p_address,
    p_scheduled_date::date, p_start_time::time, p_end_time::time,
    GREATEST(COALESCE(p_duration_days, 1), 1), p_time_block,
    v_is_full_day, v_resource_hours,
    'scheduled', NULL, NULL, p_product_count, p_salesforce_url,
    p_actor_id, 'rforce_approved', 'linked_pending_confirmation'
  ) RETURNING * INTO v_appt;

  INSERT INTO sched_appointment_links (
    appointment_id, source_system, external_key, work_order_number,
    order_number, match_method, linked_by
  ) VALUES (
    v_appt.id, 'rforce', p_rforce_order_id, TRIM(p_work_order_number),
    p_order_number, 'auto', NULLIF(p_actor_id, '')::uuid
  ) RETURNING * INTO v_link;

  INSERT INTO sched_appointment_events (
    appointment_id, action, actor_id, actor_name_snapshot,
    before_state, after_state, reason
  ) VALUES (
    v_appt.id, 'created', NULLIF(p_actor_id, '')::uuid, p_actor_name, NULL,
    jsonb_build_object('work_order_number', TRIM(p_work_order_number), 'source', 'rforce_approval'),
    'Confirmed from rForce import'
  );

  RETURN jsonb_build_object('appointment_id', v_appt.id, 'link_id', v_link.id);
END;
$$;

COMMIT;
