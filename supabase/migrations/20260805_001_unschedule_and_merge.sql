-- Migration: Add unschedule support + merge tracking
-- Allows appointments to be "unscheduled" (returned to queue) with nullable scheduling fields

-- 1. Add 'unscheduled' to the status CHECK constraint
ALTER TABLE sched_appointments
  DROP CONSTRAINT IF EXISTS sched_appointments_status_check;
ALTER TABLE sched_appointments
  ADD CONSTRAINT sched_appointments_status_check
  CHECK (status IN (
    'scheduled', 'confirmed', 'in_progress', 'complete',
    'cancelled', 'rescheduled', 'unscheduled'
  ));

-- 2. Make scheduling columns nullable for unscheduled appointments
ALTER TABLE sched_appointments ALTER COLUMN crew_id DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN scheduled_date DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN end_time DROP NOT NULL;

-- 3. Enforce NOT NULL when status != 'unscheduled'
ALTER TABLE sched_appointments ADD CONSTRAINT chk_scheduled_fields
  CHECK (
    status = 'unscheduled'
    OR (crew_id IS NOT NULL AND scheduled_date IS NOT NULL
        AND start_time IS NOT NULL AND end_time IS NOT NULL)
  );

-- 4. Update double-book index to exclude unscheduled
DROP INDEX IF EXISTS idx_no_double_book;
CREATE UNIQUE INDEX idx_no_double_book
  ON sched_appointments(crew_id, scheduled_date, time_block)
  WHERE status NOT IN ('cancelled', 'unscheduled');

-- 5. Track merge provenance
ALTER TABLE sched_appointments ADD COLUMN IF NOT EXISTS merge_source_wo TEXT;

-- 6. Add 'unscheduled' and 'merged' to event action CHECK
ALTER TABLE sched_appointment_events
  DROP CONSTRAINT IF EXISTS sched_appointment_events_action_check;
ALTER TABLE sched_appointment_events
  ADD CONSTRAINT sched_appointment_events_action_check
  CHECK (action IN (
    'created', 'updated', 'rescheduled', 'cancelled', 'restored',
    'helper_added', 'helper_removed', 'linked', 'flagged',
    'drag_moved', 'drag_resized', 'approved_from_rforce',
    'unscheduled', 'merged'
  ));
