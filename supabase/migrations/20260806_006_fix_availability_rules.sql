-- Fix availability rules: add missing repeat_interval column and anon access

-- Add repeat_interval column if not present (migration 005 was never applied)
DO $$ BEGIN
  ALTER TABLE sched_availability_rules
    ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- Allow anon users to read and manage availability rules (soft auth gate)
CREATE POLICY "Anon can read availability rules"
  ON sched_availability_rules FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can manage availability rules"
  ON sched_availability_rules FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Same for exceptions
CREATE POLICY "Anon can read availability exceptions"
  ON sched_availability_exceptions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can manage availability exceptions"
  ON sched_availability_exceptions FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
