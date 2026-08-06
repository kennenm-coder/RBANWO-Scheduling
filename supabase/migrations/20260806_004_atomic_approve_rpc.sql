-- Phase 7: Atomic RPC for rForce order approval.
-- Wraps appointment creation, link, and audit event in a single transaction.
-- If any step fails, the whole operation rolls back.

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
  p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_appt_id uuid;
  v_appt_version integer;
  v_link_id uuid;
BEGIN
  -- 1. Create the appointment
  INSERT INTO sched_appointments (
    crew_id, secondary_crew_id, tertiary_crew_id,
    appointment_type, order_number, work_order_number,
    customer_name, address, scheduled_date,
    start_time, end_time, duration_days, time_block,
    status, notes, reschedule_reason,
    product_count, salesforce_url, scheduled_by,
    origin, sync_state
  ) VALUES (
    p_crew_id, NULL, NULL,
    p_appointment_type, p_order_number, p_work_order_number,
    p_customer_name, p_address, p_scheduled_date,
    p_start_time, p_end_time, 1, p_time_block,
    'scheduled', NULL, NULL,
    p_product_count, p_salesforce_url, p_actor_id,
    'rforce_approved', 'linked_pending_confirmation'
  )
  RETURNING id, version INTO v_appt_id, v_appt_version;

  -- 2. Create the link
  INSERT INTO sched_appointment_links (
    appointment_id, source_system, external_key,
    work_order_number, order_number, match_method
  ) VALUES (
    v_appt_id, 'rforce', p_rforce_order_id,
    p_work_order_number, p_order_number, 'auto'
  )
  RETURNING id INTO v_link_id;

  -- 3. Update the appointment with WO/order identifiers from the link
  UPDATE sched_appointments
  SET work_order_number = p_work_order_number,
      order_number = p_order_number,
      salesforce_url = p_salesforce_url
  WHERE id = v_appt_id;

  -- 4. Create audit event
  INSERT INTO sched_appointment_events (
    appointment_id, action,
    actor_id, actor_name_snapshot,
    before_state, after_state, reason
  ) VALUES (
    v_appt_id, 'created',
    p_actor_id, p_actor_name,
    NULL,
    jsonb_build_object(
      'work_order_number', p_work_order_number,
      'source', 'rforce_approval'
    ),
    'Approved from rForce import'
  );

  -- Return the created appointment and link IDs
  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'appointment_version', v_appt_version,
    'link_id', v_link_id
  );
END;
$$;
