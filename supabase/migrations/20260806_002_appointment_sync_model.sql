-- Phase 2a: Canonical appointment sync model
-- Adds origin tracking, sync state machine, original-entry snapshot,
-- and import reconciliation reference.
--
-- Safe defaults: existing rows get origin='manual', sync_state='manual_awaiting_rforce'.
-- Appointments that already have an active link get sync_state='in_sync'.

-- 1. Origin: how the appointment was created
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'rforce_approved', 'merged'));

COMMENT ON COLUMN sched_appointments.origin IS
  'How this appointment was created: manual entry, approved from rForce, or merged from both sources';

-- 2. Sync state machine
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'manual_awaiting_rforce'
    CHECK (sync_state IN (
      'manual_awaiting_rforce',    -- Manual entry, no rForce match yet
      'match_suggested',           -- Import found a likely rForce match
      'linked_pending_confirmation', -- Linked but not yet import-confirmed
      'waiting_for_import',        -- Scheduler made changes, waiting for rForce to catch up
      'in_sync',                   -- App and rForce agree
      'source_missing',            -- Was linked but rForce record disappeared
      'ambiguous_match',           -- Multiple rForce candidates, needs human review
      'conflict'                   -- App and rForce disagree after import
    ));

COMMENT ON COLUMN sched_appointments.sync_state IS
  'Current synchronization state between app and rForce';

-- 3. Original entry snapshot — immutable record of what the scheduler typed
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS original_entry_snapshot jsonb;

COMMENT ON COLUMN sched_appointments.original_entry_snapshot IS
  'Immutable snapshot of the scheduler original manual entry (customer, address, date, crew, notes). Never overwritten.';

-- 4. Last reconciled import reference
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS last_reconciled_import_id text;

COMMENT ON COLUMN sched_appointments.last_reconciled_import_id IS
  'ID of the last CSV import that was reconciled against this appointment';

-- 5. Backfill: appointments with active links should be in_sync, not manual_awaiting_rforce
UPDATE sched_appointments a
SET sync_state = 'in_sync'
WHERE EXISTS (
  SELECT 1 FROM sched_appointment_links l
  WHERE l.appointment_id = a.id
    AND l.unlinked_at IS NULL
)
AND a.sync_state = 'manual_awaiting_rforce';

-- 6. Backfill: appointments created via rForce approval
UPDATE sched_appointments
SET origin = 'rforce_approved'
WHERE id IN (
  SELECT appointment_id FROM sched_appointment_events
  WHERE action = 'approved_from_rforce'
);

-- 7. Backfill: appointments that were merged
UPDATE sched_appointments
SET origin = 'merged'
WHERE merge_source_wo IS NOT NULL;

-- 8. Add 'sync_state_changed' to appointment events action CHECK
ALTER TABLE sched_appointment_events
  DROP CONSTRAINT IF EXISTS sched_appointment_events_action_check;

ALTER TABLE sched_appointment_events
  ADD CONSTRAINT sched_appointment_events_action_check
  CHECK (action IN (
    'created', 'updated', 'rescheduled', 'cancelled', 'restored',
    'helper_added', 'helper_removed', 'linked', 'flagged',
    'drag_moved', 'drag_resized', 'approved_from_rforce',
    'unscheduled', 'merged', 'sync_state_changed'
  ));
