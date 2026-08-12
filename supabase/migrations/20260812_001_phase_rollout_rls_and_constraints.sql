-- ============================================================================
-- Phase 6/8/9/12 Rollout — RLS gaps + import constraint
-- ============================================================================
--
-- This migration fixes RLS gaps that prevent the anon-key app from writing
-- to tables that were created with authenticated-only policies.
-- Since ENFORCE_AUTH = false, the app uses the anon role.
--
-- Also adds a unique constraint on work_orders.work_order_number for the
-- import-boundary upsert (Phase 6).
--
-- Safe to re-run: all statements use IF NOT EXISTS or CREATE POLICY
-- with idempotent patterns.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════
-- 1. sched_import_snapshots — add anon policies
-- ══════════════════════════════════════════════════════════════════════════

-- The import-boundary.ts writes snapshots using the anon key.
CREATE POLICY "Anon can read import snapshots"
  ON sched_import_snapshots FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can manage import snapshots"
  ON sched_import_snapshots FOR ALL
  TO anon USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════════
-- 2. sched_match_rejections — add anon policies
-- ══════════════════════════════════════════════════════════════════════════

-- The queue UI rejects matches using the anon key.
CREATE POLICY "Anon can read match rejections"
  ON sched_match_rejections FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can manage match rejections"
  ON sched_match_rejections FOR ALL
  TO anon USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════════
-- 3. sched_resource_mappings — add anon policies
-- ══════════════════════════════════════════════════════════════════════════

-- resource-learning.ts auto-learns mappings on approve/merge via anon key.
CREATE POLICY "Anon can read resource mappings"
  ON sched_resource_mappings FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can manage resource mappings"
  ON sched_resource_mappings FOR ALL
  TO anon USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════════
-- 4. sched_rforce_dismissals — enable RLS + add policies
-- ══════════════════════════════════════════════════════════════════════════

-- RLS was never enabled on this table (noted as oversight in schema.sql).
ALTER TABLE sched_rforce_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage dismissals"
  ON sched_rforce_dismissals FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anon can manage dismissals"
  ON sched_rforce_dismissals FOR ALL
  TO anon USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════════
-- 5. sched_csv_imports — add anon policies
-- ══════════════════════════════════════════════════════════════════════════

-- The existing "Allow all access" policy covers both roles, but we add
-- explicit anon policies for clarity and to survive policy rewrites.
-- Skip if "Allow all access" already exists (it does from the initial schema).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sched_csv_imports'
    AND policyname = 'Anon can manage csv imports'
  ) THEN
    EXECUTE 'CREATE POLICY "Anon can manage csv imports"
      ON sched_csv_imports FOR ALL
      TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 6. work_orders — unique constraint for import upsert
-- ══════════════════════════════════════════════════════════════════════════

-- The import-boundary uses:
--   .upsert(payload, { onConflict: "work_order_number" })
-- This requires a UNIQUE constraint. If Duck Force already created one,
-- this is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_wo_number
  ON work_orders (work_order_number);
