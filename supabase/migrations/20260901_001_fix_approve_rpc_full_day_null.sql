-- Fix: approving a TIMED rForce order (service/jip/hoa/job_site_visit/paint_stain/
-- tech_measure) fails with
--   "null value in column is_full_day of relation sched_appointments violates not-null constraint".
--
-- Root cause: timed types carry no time_block, so the app passes p_time_block = NULL
-- to approve_rforce_order. The full-day flag was computed as
--   v_is_full_day boolean := (p_time_block = 'full_day');
-- and in SQL `NULL = 'full_day'` is NULL (not false). That NULL was then inserted
-- into is_full_day, which is NOT NULL — an explicit NULL overrides the column's
-- DEFAULT false, so the insert is rejected. Full-day installs/measures had a
-- non-null block and were unaffected.
--
-- Only v_is_full_day needs the guard; v_resource_hours already uses explicit
-- WHEN checks that treat a NULL block correctly. COALESCE(..., false) makes the
-- flag NULL-safe: a timed job (no block) is not full-day.

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
