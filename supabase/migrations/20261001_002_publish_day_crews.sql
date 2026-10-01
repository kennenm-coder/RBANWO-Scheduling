-- Publish each job's per-day crew list onto work_orders, for Duck Force.
--
-- Duck Force draws its calendar from work_orders, which carries one resource per
-- row because that is all rForce exports. Helper crews assigned in this app live
-- in sched_appointments and never reached it, so a two-crew job showed one crew.
--
-- work_orders.day_crews is a date-keyed map of every crew standing on the job
-- that day, built from the same sched_crew_days() expansion the conflict guard
-- uses — so a helper on day 2 only appears under day 2:
--
--   {"2026-10-05": ["Crew A"],
--    "2026-10-06": ["Crew A", "Crew B"],
--    "2026-10-07": ["Crew A"]}
--
-- Maintained by trigger rather than by the app. Every path that moves a job —
-- the modal, a drag, an rForce approval, the atomic RPC, unschedule, cancel —
-- then stays in sync with no client wiring and nothing to drift. The rForce
-- import never touches this column, so its hourly upsert cannot clobber it
-- (same arrangement as work_orders.scheduler_notes).
--
-- Duck Force reads it and renders one tile per day listing that day's crews.
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE; triggers recreated).

BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS day_crews jsonb;

COMMENT ON COLUMN work_orders.day_crews IS
  'Date-keyed map of crew names working this job each day, published from sched_appointments by trigger. Owned by the scheduling app; the rForce import must not write it.';

-- ── The map for one work order ────────────────────────────────────────────────
-- NULL when the job has no live appointment (cancelled, queued, or gone), which
-- is how the column clears itself.
CREATE OR REPLACE FUNCTION sched_day_crews_map(p_wo text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_object_agg(d.work_date::text, d.names)
  FROM (
    SELECT cd.work_date,
           jsonb_agg(DISTINCT c.name ORDER BY c.name) AS names
    FROM sched_appointments a
    CROSS JOIN LATERAL sched_crew_days(
           a.crew_id, a.secondary_crew_id, a.tertiary_crew_id,
           a.secondary_day_offsets, a.tertiary_day_offsets,
           a.scheduled_date, a.duration_days
         ) AS cd
    JOIN sched_crews c ON c.id = cd.crew_id
    WHERE a.work_order_number = p_wo
      AND a.status NOT IN ('cancelled', 'unscheduled')
    GROUP BY cd.work_date
  ) d;
$fn$;

-- ── Recompute one work order ──────────────────────────────────────────────────
-- SECURITY DEFINER: the writer here holds permission on sched_appointments, not
-- necessarily on work_orders, and this is a derived projection either way.
CREATE OR REPLACE FUNCTION sched_publish_day_crews(p_wo text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE work_orders w
     SET day_crews = sched_day_crews_map(p_wo)
   WHERE w.work_order_number = p_wo
     -- Don't churn the row when nothing actually changed.
     AND w.day_crews IS DISTINCT FROM sched_day_crews_map(p_wo);
$fn$;

-- ── Republish when an appointment changes ─────────────────────────────────────
CREATE OR REPLACE FUNCTION sched_appointments_publish_day_crews()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- A row moving between work orders has to refresh both sides.
  IF TG_OP <> 'INSERT' AND OLD.work_order_number IS NOT NULL THEN
    PERFORM sched_publish_day_crews(OLD.work_order_number);
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.work_order_number IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.work_order_number IS DISTINCT FROM OLD.work_order_number) THEN
    PERFORM sched_publish_day_crews(NEW.work_order_number);
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sched_appointments_publish_day_crews ON sched_appointments;
CREATE TRIGGER trg_sched_appointments_publish_day_crews
  AFTER INSERT OR DELETE OR UPDATE OF
    crew_id, secondary_crew_id, tertiary_crew_id,
    secondary_day_offsets, tertiary_day_offsets,
    scheduled_date, duration_days, status, work_order_number
  ON sched_appointments
  FOR EACH ROW
  EXECUTE FUNCTION sched_appointments_publish_day_crews();

-- ── Republish when a crew is renamed ──────────────────────────────────────────
-- The map stores names, which is what Duck Force matches on, so a rename has to
-- flow through. Rare, and scoped to that crew's own jobs.
CREATE OR REPLACE FUNCTION sched_crews_republish_day_crews()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  wo text;
BEGIN
  FOR wo IN
    SELECT DISTINCT a.work_order_number
    FROM sched_appointments a
    WHERE a.work_order_number IS NOT NULL
      AND NEW.id IN (a.crew_id, a.secondary_crew_id, a.tertiary_crew_id)
  LOOP
    PERFORM sched_publish_day_crews(wo);
  END LOOP;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sched_crews_republish_day_crews ON sched_crews;
CREATE TRIGGER trg_sched_crews_republish_day_crews
  AFTER UPDATE OF name ON sched_crews
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION sched_crews_republish_day_crews();

-- ── Seed the existing rows ────────────────────────────────────────────────────
-- Every work order that has a live appointment, so Duck Force has the full
-- picture the moment it starts reading the column.
DO $seed$
DECLARE
  wo text;
BEGIN
  FOR wo IN
    SELECT DISTINCT work_order_number
    FROM sched_appointments
    WHERE work_order_number IS NOT NULL
      AND status NOT IN ('cancelled', 'unscheduled')
  LOOP
    PERFORM sched_publish_day_crews(wo);
  END LOOP;
END
$seed$;

COMMIT;
