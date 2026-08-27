-- Two-tier "dropped from rForce" cancellation detection.
--
-- rForce cancellations don't arrive as a status — a cancelled job simply stops
-- appearing in the daily full export (see docs/phase2-dropped-from-rforce.md and
-- src/lib/rforce-staleness.ts). To count *how many* daily exports an order has
-- missed (1 = amber "possible cancel", 2+ = red "likely cancel"), we need a record
-- of which days a full export actually ran — the work_orders table can't tell us,
-- because each daily export overwrites updated_at and erases the prior day's.
--
-- Power Automate writes work_orders directly and has no app-side import hook, so
-- the app records each daily export it observes on load (see recordImportRun in
-- src/lib/store.ts). One row per export day; history accumulates forward.

CREATE TABLE IF NOT EXISTS sched_import_runs (
  run_date    date PRIMARY KEY,
  order_count integer NOT NULL DEFAULT 0,
  first_seen  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sched_import_runs IS
  'One row per day a full rForce daily export was observed. Used to count missed exports for cancellation detection. See src/lib/rforce-staleness.ts.';

ALTER TABLE sched_import_runs ENABLE ROW LEVEL SECURITY;

-- Soft auth gate (no login required). Postgres has no CREATE POLICY IF NOT
-- EXISTS, so drop-then-create keeps this migration idempotent/re-runnable.
DROP POLICY IF EXISTS "Anon can read import runs" ON sched_import_runs;
CREATE POLICY "Anon can read import runs"
  ON sched_import_runs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can record import runs" ON sched_import_runs;
CREATE POLICY "Anon can record import runs"
  ON sched_import_runs FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read import runs" ON sched_import_runs;
CREATE POLICY "Authenticated can read import runs"
  ON sched_import_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can record import runs" ON sched_import_runs;
CREATE POLICY "Authenticated can record import runs"
  ON sched_import_runs FOR INSERT TO authenticated WITH CHECK (true);
