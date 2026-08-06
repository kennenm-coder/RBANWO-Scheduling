-- Phase 13: RLS lockdown for tables missing row-level security.
--
-- Tables covered:
--   sched_appointment_links    — was created without RLS
--   sched_resource_mappings    — was created without RLS
--   sched_rforce_dismissals    — was created without RLS
--   sched_flag_resolutions     — was created without RLS
--   sched_reconciliation_results — was created without RLS
--
-- Policy: authenticated users get full read/write. The app is internal-only
-- and role enforcement is done in the UI layer via UserProfile.role.
-- Anon (unauthenticated) access is blocked.

-- ── sched_appointment_links ──
ALTER TABLE sched_appointment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read links"
  ON sched_appointment_links FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage links"
  ON sched_appointment_links FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── sched_resource_mappings ──
ALTER TABLE sched_resource_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read mappings"
  ON sched_resource_mappings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage mappings"
  ON sched_resource_mappings FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── sched_rforce_dismissals ──
ALTER TABLE sched_rforce_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dismissals"
  ON sched_rforce_dismissals FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage dismissals"
  ON sched_rforce_dismissals FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── sched_flag_resolutions ──
ALTER TABLE sched_flag_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read resolutions"
  ON sched_flag_resolutions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage resolutions"
  ON sched_flag_resolutions FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── sched_reconciliation_results ──
ALTER TABLE sched_reconciliation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read reconciliation"
  ON sched_reconciliation_results FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage reconciliation"
  ON sched_reconciliation_results FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
