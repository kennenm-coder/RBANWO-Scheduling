-- Cancellation audit repair + terminal sync state
--
-- Two long-standing defects, both invisible until a cancelled tile was examined:
--
-- 1. sched_appointments.cancelled_at / cancelled_by / cancellation_reason have
--    existed since 20260730_002_appointment_audit, but nothing ever wrote them.
--    cancelAppointment() put the reason in reschedule_reason (the *reschedule*
--    column) and left all three audit columns NULL. Every cancelled row in the
--    table is affected.
--
-- 2. sync_state had no terminal state for "cancelled in the app", so a cancelled
--    tile kept whatever state it held while live (in_sync,
--    linked_pending_confirmation, manual_awaiting_rforce...). The sync machine
--    never learned the job was off, and the reconciler went on treating the row
--    as a live booking.
--
-- The real actor and timestamp survived in sched_appointment_events, so the
-- audit trail is recoverable rather than lost.
--
-- Idempotent: safe to re-run. Wrapped in a transaction — all of it lands or none.

BEGIN;

-- ── 1. Allow the new terminal sync state ────────────────────────────────────
-- The existing CHECK is dropped by lookup rather than by name: it was created in
-- two different migrations (20260806_002 and the 20260812_002 catch-up), so the
-- generated name is not reliably the same across environments.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'sched_appointments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%sync_state%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sched_appointments DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE sched_appointments
  ADD CONSTRAINT sched_appointments_sync_state_check
  CHECK (sync_state IN (
    'manual_awaiting_rforce',      -- Manual entry, no rForce match yet
    'match_suggested',             -- Import found a likely rForce match
    'linked_pending_confirmation', -- Linked but not yet import-confirmed
    'waiting_for_import',          -- Scheduler made changes, waiting for rForce
    'in_sync',                     -- App and rForce agree
    'source_missing',              -- Was linked but rForce record disappeared
    'ambiguous_match',             -- Multiple rForce candidates, needs review
    'conflict',                    -- App and rForce disagree after import
    'cancelled'                    -- Terminal: cancelled in the app
  ));

-- ── 2. Recover the audit trail from the events log ──────────────────────────
-- Most recent 'cancelled' event per appointment carries the true actor, time and
-- reason. COALESCE throughout so a re-run never overwrites a correct value.
WITH cancel_event AS (
  SELECT DISTINCT ON (appointment_id)
         appointment_id,
         actor_id,
         created_at,
         reason
  FROM sched_appointment_events
  WHERE action = 'cancelled'
  ORDER BY appointment_id, created_at DESC
)
UPDATE sched_appointments a
SET cancelled_at = COALESCE(a.cancelled_at, e.created_at),
    cancelled_by = COALESCE(a.cancelled_by, e.actor_id),
    cancellation_reason = COALESCE(
      a.cancellation_reason,
      NULLIF(BTRIM(e.reason), ''),
      NULLIF(BTRIM(a.reschedule_reason), '')
    )
FROM cancel_event e
WHERE a.id = e.appointment_id
  AND a.status = 'cancelled'
  AND (a.cancelled_at IS NULL
       OR a.cancelled_by IS NULL
       OR a.cancellation_reason IS NULL);

-- Rows cancelled before the events log existed (or whose event was pruned) have
-- no actor to recover. Fall back to updated_at for the timestamp and the
-- misfiled reschedule_reason for the text; cancelled_by stays NULL rather than
-- being invented.
UPDATE sched_appointments a
SET cancelled_at = COALESCE(a.cancelled_at, a.updated_at),
    cancellation_reason = COALESCE(
      a.cancellation_reason,
      NULLIF(BTRIM(a.reschedule_reason), '')
    )
WHERE a.status = 'cancelled'
  AND (a.cancelled_at IS NULL OR a.cancellation_reason IS NULL);

-- ── 3. Move cancelled tiles to the terminal sync state ──────────────────────
-- status='cancelled' is the authority; the prior sync_state described a booking
-- that no longer exists. A restore re-derives from scratch (see
-- restoreAppointment() in src/lib/store.ts), so nothing needs the old value.
UPDATE sched_appointments
SET sync_state = 'cancelled'
WHERE status = 'cancelled'
  AND sync_state <> 'cancelled';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect zero rows from each:
--
--   SELECT count(*) FROM sched_appointments
--   WHERE status = 'cancelled' AND cancelled_at IS NULL;
--
--   SELECT count(*) FROM sched_appointments
--   WHERE status = 'cancelled' AND sync_state <> 'cancelled';
--
-- cancelled_by may legitimately remain NULL on rows with no recoverable event:
--
--   SELECT count(*) FROM sched_appointments
--   WHERE status = 'cancelled' AND cancelled_by IS NULL;
