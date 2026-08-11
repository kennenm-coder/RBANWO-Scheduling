-- Migration: Add tertiary_crew_id to sched_appointments
--
-- This column was added to the live database manually but never committed
-- as a migration. App code (ScheduleModal, AppointmentCard, AppointmentSheet,
-- store.ts) and other migrations (003_appointment_resources backfill,
-- 004_atomic_approve_rpc INSERT) already reference it.
--
-- Idempotent: IF NOT EXISTS prevents failure if already present.

ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS tertiary_crew_id UUID REFERENCES sched_crews(id);
