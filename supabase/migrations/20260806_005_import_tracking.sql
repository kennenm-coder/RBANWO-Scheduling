-- Phase 3: Import tracking, snapshots, and match rejection memory.
--
-- 1. Enhanced csv_imports with fingerprinting
-- 2. Import order snapshots for change detection
-- 3. Match rejections ("not a match" memory)

-- ── 1. Enhance csv_imports with fingerprinting ──
-- Add a content hash so we can detect duplicate/re-imports

ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS order_count integer;

ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS changed_count integer;

ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS new_count integer;

COMMENT ON COLUMN csv_imports.content_hash IS
  'SHA-256 hash of the import file content for duplicate detection';

-- ── 2. Import order snapshots ──
-- Captures what each rForce order looked like at each import.
-- Used to detect what changed between imports for targeted reconciliation.

CREATE TABLE IF NOT EXISTS sched_import_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES csv_imports(id) ON DELETE CASCADE,
  work_order_number text NOT NULL,
  snapshot jsonb NOT NULL,
  change_summary jsonb,  -- null if first seen; otherwise {field: {old, new}}
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_snapshots_wo
  ON sched_import_snapshots (work_order_number);

CREATE INDEX IF NOT EXISTS idx_import_snapshots_import
  ON sched_import_snapshots (import_id);

COMMENT ON TABLE sched_import_snapshots IS
  'Per-order data snapshot at each import. Enables change-detection between imports.';

-- ── 3. Match rejection memory ("not a match") ──
-- When a scheduler rejects a suggested match, record it so the same
-- suggestion is never shown again, even after re-import.

CREATE TABLE IF NOT EXISTS sched_match_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
  work_order_number text NOT NULL,
  rejected_by text,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_rejection
  ON sched_match_rejections (appointment_id, work_order_number);

COMMENT ON TABLE sched_match_rejections IS
  'Records when a scheduler explicitly rejects a suggested match. Prevents the same suggestion from reappearing.';

-- ── RLS ──
ALTER TABLE sched_import_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read snapshots"
  ON sched_import_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage snapshots"
  ON sched_import_snapshots FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE sched_match_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rejections"
  ON sched_match_rejections FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage rejections"
  ON sched_match_rejections FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
