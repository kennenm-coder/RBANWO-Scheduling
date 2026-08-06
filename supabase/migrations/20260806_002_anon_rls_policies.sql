-- Add anon RLS policies for all tables that need write access
-- with the soft auth gate (no login required to use app).
-- These tables already have RLS enabled with authenticated-only policies.

-- sched_appointment_events (audit log)
CREATE POLICY IF NOT EXISTS "Anon can read appointment events"
  ON sched_appointment_events FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS "Anon can insert appointment events"
  ON sched_appointment_events FOR INSERT TO anon WITH CHECK (true);

-- sched_appointment_links
CREATE POLICY IF NOT EXISTS "Anon can read appointment links"
  ON sched_appointment_links FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS "Anon can manage appointment links"
  ON sched_appointment_links FOR ALL TO anon USING (true) WITH CHECK (true);

-- sched_flag_resolutions
CREATE POLICY IF NOT EXISTS "Anon can read flag resolutions"
  ON sched_flag_resolutions FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS "Anon can manage flag resolutions"
  ON sched_flag_resolutions FOR ALL TO anon USING (true) WITH CHECK (true);
