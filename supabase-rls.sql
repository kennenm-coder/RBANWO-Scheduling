-- Enable RLS and add permissive policies for the scheduling app
-- This is an internal tool, so we allow full access via the anon key

-- sched_crews
ALTER TABLE sched_crews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_crews" ON sched_crews
  FOR ALL USING (true) WITH CHECK (true);

-- sched_appointments
ALTER TABLE sched_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_appointments" ON sched_appointments
  FOR ALL USING (true) WITH CHECK (true);

-- sched_csv_imports
ALTER TABLE sched_csv_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_csv_imports" ON sched_csv_imports
  FOR ALL USING (true) WITH CHECK (true);

-- sched_rforce_orders
ALTER TABLE sched_rforce_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_rforce_orders" ON sched_rforce_orders
  FOR ALL USING (true) WITH CHECK (true);

-- sched_settings
ALTER TABLE sched_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_settings" ON sched_settings
  FOR ALL USING (true) WITH CHECK (true);
