-- Active Work-Order Uniqueness for Local Appointments
-- Prevents duplicate active appointments for the same normalized work order number.
-- "Active" means status is NOT 'cancelled'.
--
-- This migration is idempotent: drops and recreates the index.
-- Pre-existing duplicates will cause this migration to fail — run the
-- preflight query below first to identify and resolve them.
--
-- Preflight (run manually before applying):
--   SELECT LOWER(TRIM(work_order_number)) AS normalized_wo, count(*), array_agg(id)
--   FROM sched_appointments
--   WHERE work_order_number IS NOT NULL
--     AND TRIM(work_order_number) <> ''
--     AND status != 'cancelled'
--   GROUP BY LOWER(TRIM(work_order_number))
--   HAVING count(*) > 1;
--

-- Drop if exists (idempotent)
DROP INDEX IF EXISTS idx_unique_active_work_order;

-- Partial unique index: only one active appointment per normalized WO
-- Uses LOWER(TRIM(...)) so "WO-123 " and "wo-123" collide correctly
CREATE UNIQUE INDEX idx_unique_active_work_order
  ON sched_appointments (LOWER(TRIM(work_order_number)))
  WHERE work_order_number IS NOT NULL
    AND TRIM(work_order_number) <> ''
    AND status != 'cancelled';

-- Also add an index for the common query pattern: crew + date overlap queries
-- Used by conflict checks for scheduling validation
DROP INDEX IF EXISTS idx_appointments_crew_date_active;

CREATE INDEX idx_appointments_crew_date_active
  ON sched_appointments (crew_id, scheduled_date)
  WHERE status != 'cancelled';

COMMENT ON INDEX idx_unique_active_work_order IS
  'Enforces at most one active (non-cancelled) appointment per work_order_number. '
  'This is the database-level backstop for the client-side duplicate-WO check in approveRForceOrder.';
