-- Manual override tracking + multi-block time spans for drag-to-reschedule

ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_source jsonb,
  ADD COLUMN IF NOT EXISTS time_block_end text;

COMMENT ON COLUMN sched_appointments.manual_override IS 'True when a scheduler intentionally moved this appointment away from rForce data';
COMMENT ON COLUMN sched_appointments.override_source IS 'Snapshot of original rForce values at override time: {crew_name, scheduled_date, time_block}';
COMMENT ON COLUMN sched_appointments.time_block_end IS 'End block for multi-block spans (resize). Null = single block.';

-- Expand appointment_events action check to include drag actions
-- Drop and recreate the constraint to add new values
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'sched_appointment_events_action_check'
  ) THEN
    ALTER TABLE sched_appointment_events DROP CONSTRAINT sched_appointment_events_action_check;
  END IF;
END $$;

ALTER TABLE sched_appointment_events
  ADD CONSTRAINT sched_appointment_events_action_check
  CHECK (action IN ('created', 'updated', 'rescheduled', 'cancelled', 'restored', 'helper_added', 'helper_removed', 'linked', 'flagged', 'drag_moved', 'drag_resized'));
