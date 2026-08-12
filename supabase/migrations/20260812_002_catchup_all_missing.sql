-- ============================================================================
-- CATCH-UP MIGRATION — run this once to bring Supabase up to date
-- ============================================================================
--
-- This single script covers every table, column, index, constraint, and RLS
-- policy from migrations 20260803 through 20260812 that may not have been
-- applied yet.
--
-- Fully idempotent — safe to run even if some or all migrations were already
-- applied:
--   • CREATE TABLE IF NOT EXISTS / ALTER TABLE … ADD COLUMN IF NOT EXISTS
--   • CREATE INDEX IF NOT EXISTS
--   • Policy creation wrapped in DO $$ IF NOT EXISTS blocks
--   • ALTER TABLE ENABLE ROW LEVEL SECURITY is idempotent
--   • Constraint drops use IF EXISTS before re-adding
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).
-- ============================================================================


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION A: CREATE MISSING TABLES                                         ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── A1. sched_appointment_links ──
CREATE TABLE IF NOT EXISTS sched_appointment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'rforce',
  external_key text NOT NULL,
  work_order_number text,
  order_number text,
  match_method text NOT NULL DEFAULT 'manual',
  linked_by uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_by uuid,
  unlinked_at timestamptz,
  unlink_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_link_appointment
  ON sched_appointment_links (appointment_id)
  WHERE unlinked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_link_external
  ON sched_appointment_links (source_system, external_key)
  WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_links_external_key
  ON sched_appointment_links (source_system, external_key);

CREATE INDEX IF NOT EXISTS idx_links_active
  ON sched_appointment_links (appointment_id)
  WHERE unlinked_at IS NULL;


-- ── A2. sched_resource_mappings ──
CREATE TABLE IF NOT EXISTS sched_resource_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  crew_id uuid NOT NULL REFERENCES sched_crews(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_mapping_name
  ON sched_resource_mappings (lower(raw_name))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_resource_mappings_crew
  ON sched_resource_mappings (crew_id)
  WHERE is_active = true;


-- ── A3. sched_rforce_dismissals ──
CREATE TABLE IF NOT EXISTS sched_rforce_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_number text NOT NULL,
  rforce_date text NOT NULL,
  rforce_start_time text,
  dismissed_by text,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dismissal_wo_date
  ON sched_rforce_dismissals (work_order_number, rforce_date);


-- ── A4. sched_flag_resolutions ──
CREATE TABLE IF NOT EXISTS sched_flag_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  resolved_by text,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_flag_resolution
  ON sched_flag_resolutions (flag_key);


-- ── A5. sched_reconciliation_results ──
CREATE TABLE IF NOT EXISTS sched_reconciliation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES sched_appointment_links(id) ON DELETE CASCADE,
  sync_status text NOT NULL,
  differences jsonb,
  app_date text,
  app_crew_id uuid,
  app_time_block text,
  rforce_date text,
  rforce_resource text,
  rforce_status text,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_link
  ON sched_reconciliation_results (link_id);


-- ── A6. sched_import_snapshots ──
CREATE TABLE IF NOT EXISTS sched_import_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES sched_csv_imports(id) ON DELETE CASCADE,
  work_order_number text NOT NULL,
  snapshot jsonb NOT NULL,
  change_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_snapshots_wo
  ON sched_import_snapshots (work_order_number);

CREATE INDEX IF NOT EXISTS idx_import_snapshots_import
  ON sched_import_snapshots (import_id);


-- ── A7. sched_match_rejections ──
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


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION B: ALTER TABLE — add missing columns + constraints               ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── B1. sched_csv_imports — import fingerprinting columns ──
ALTER TABLE sched_csv_imports ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE sched_csv_imports ADD COLUMN IF NOT EXISTS order_count integer;
ALTER TABLE sched_csv_imports ADD COLUMN IF NOT EXISTS changed_count integer;
ALTER TABLE sched_csv_imports ADD COLUMN IF NOT EXISTS new_count integer;

-- ── B2. sched_appointments — tertiary crew ──
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS tertiary_crew_id UUID REFERENCES sched_crews(id);

-- ── B3. sched_appointments — merge tracking ──
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS merge_source_wo TEXT;

-- ── B4. sched_appointments — sync model columns ──
-- origin: how the appointment was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sched_appointments' AND column_name = 'origin'
  ) THEN
    ALTER TABLE sched_appointments
      ADD COLUMN origin text NOT NULL DEFAULT 'manual'
        CHECK (origin IN ('manual', 'rforce_approved', 'merged'));
  END IF;
END $$;

-- sync_state: 8-state sync machine
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sched_appointments' AND column_name = 'sync_state'
  ) THEN
    ALTER TABLE sched_appointments
      ADD COLUMN sync_state text NOT NULL DEFAULT 'manual_awaiting_rforce'
        CHECK (sync_state IN (
          'manual_awaiting_rforce', 'match_suggested',
          'linked_pending_confirmation', 'waiting_for_import',
          'in_sync', 'source_missing', 'ambiguous_match', 'conflict'
        ));
  END IF;
END $$;

-- original_entry_snapshot + last_reconciled_import_id
ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS original_entry_snapshot jsonb;

ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS last_reconciled_import_id text;

-- ── B5. sched_appointments — unscheduled status + nullable scheduling fields ──
ALTER TABLE sched_appointments
  DROP CONSTRAINT IF EXISTS sched_appointments_status_check;
ALTER TABLE sched_appointments
  ADD CONSTRAINT sched_appointments_status_check
  CHECK (status IN (
    'scheduled', 'confirmed', 'in_progress', 'complete',
    'cancelled', 'rescheduled', 'unscheduled'
  ));

-- Make scheduling columns nullable for unscheduled appointments
-- (ALTER COLUMN DROP NOT NULL is idempotent — no error if already nullable)
ALTER TABLE sched_appointments ALTER COLUMN crew_id DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN scheduled_date DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE sched_appointments ALTER COLUMN end_time DROP NOT NULL;

-- Enforce NOT NULL when status != 'unscheduled'
ALTER TABLE sched_appointments DROP CONSTRAINT IF EXISTS chk_scheduled_fields;
ALTER TABLE sched_appointments ADD CONSTRAINT chk_scheduled_fields
  CHECK (
    status = 'unscheduled'
    OR (crew_id IS NOT NULL AND scheduled_date IS NOT NULL
        AND start_time IS NOT NULL AND end_time IS NOT NULL)
  );

-- Update double-book index to exclude unscheduled
DROP INDEX IF EXISTS idx_no_double_book;
CREATE UNIQUE INDEX idx_no_double_book
  ON sched_appointments(crew_id, scheduled_date, time_block)
  WHERE status NOT IN ('cancelled', 'unscheduled');

-- ── B6. sched_appointment_events — expand action CHECK ──
ALTER TABLE sched_appointment_events
  DROP CONSTRAINT IF EXISTS sched_appointment_events_action_check;
ALTER TABLE sched_appointment_events
  ADD CONSTRAINT sched_appointment_events_action_check
  CHECK (action IN (
    'created', 'updated', 'rescheduled', 'cancelled', 'restored',
    'helper_added', 'helper_removed', 'linked', 'flagged',
    'drag_moved', 'drag_resized', 'approved_from_rforce',
    'unscheduled', 'merged', 'sync_state_changed'
  ));


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION C: BACKFILL — populate new columns for existing data             ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- Appointments with active links → in_sync
UPDATE sched_appointments a
SET sync_state = 'in_sync'
WHERE EXISTS (
  SELECT 1 FROM sched_appointment_links l
  WHERE l.appointment_id = a.id AND l.unlinked_at IS NULL
)
AND a.sync_state = 'manual_awaiting_rforce';

-- Appointments created via rForce approval
UPDATE sched_appointments
SET origin = 'rforce_approved'
WHERE id IN (
  SELECT appointment_id FROM sched_appointment_events
  WHERE action = 'approved_from_rforce'
)
AND origin = 'manual';

-- Appointments that were merged
UPDATE sched_appointments
SET origin = 'merged'
WHERE merge_source_wo IS NOT NULL
AND origin = 'manual';


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION D: ENABLE RLS + CREATE POLICIES                                  ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- Helper: create a policy only if it doesn't already exist.
-- We wrap every CREATE POLICY in a DO $$ block.

-- ── D1. sched_appointment_links ──
ALTER TABLE sched_appointment_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_links' AND policyname='Authenticated users can read links') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read links" ON sched_appointment_links FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_links' AND policyname='Authenticated users can manage links') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage links" ON sched_appointment_links FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_links' AND policyname='Anon can read appointment links') THEN
    EXECUTE 'CREATE POLICY "Anon can read appointment links" ON sched_appointment_links FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_links' AND policyname='Anon can manage appointment links') THEN
    EXECUTE 'CREATE POLICY "Anon can manage appointment links" ON sched_appointment_links FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D2. sched_resource_mappings ──
ALTER TABLE sched_resource_mappings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_resource_mappings' AND policyname='Authenticated users can read mappings') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read mappings" ON sched_resource_mappings FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_resource_mappings' AND policyname='Authenticated users can manage mappings') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage mappings" ON sched_resource_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_resource_mappings' AND policyname='Anon can read resource mappings') THEN
    EXECUTE 'CREATE POLICY "Anon can read resource mappings" ON sched_resource_mappings FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_resource_mappings' AND policyname='Anon can manage resource mappings') THEN
    EXECUTE 'CREATE POLICY "Anon can manage resource mappings" ON sched_resource_mappings FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D3. sched_rforce_dismissals ──
ALTER TABLE sched_rforce_dismissals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_rforce_dismissals' AND policyname='Authenticated users can read dismissals') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read dismissals" ON sched_rforce_dismissals FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_rforce_dismissals' AND policyname='Authenticated users can manage dismissals') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage dismissals" ON sched_rforce_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_rforce_dismissals' AND policyname='Authenticated can manage dismissals') THEN
    EXECUTE 'CREATE POLICY "Authenticated can manage dismissals" ON sched_rforce_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_rforce_dismissals' AND policyname='Anon can manage dismissals') THEN
    EXECUTE 'CREATE POLICY "Anon can manage dismissals" ON sched_rforce_dismissals FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D4. sched_flag_resolutions ──
ALTER TABLE sched_flag_resolutions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_flag_resolutions' AND policyname='Authenticated users can read resolutions') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read resolutions" ON sched_flag_resolutions FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_flag_resolutions' AND policyname='Authenticated users can manage resolutions') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage resolutions" ON sched_flag_resolutions FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_flag_resolutions' AND policyname='Anon can read flag resolutions') THEN
    EXECUTE 'CREATE POLICY "Anon can read flag resolutions" ON sched_flag_resolutions FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_flag_resolutions' AND policyname='Anon can manage flag resolutions') THEN
    EXECUTE 'CREATE POLICY "Anon can manage flag resolutions" ON sched_flag_resolutions FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D5. sched_reconciliation_results ──
ALTER TABLE sched_reconciliation_results ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_reconciliation_results' AND policyname='Authenticated users can read reconciliation') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read reconciliation" ON sched_reconciliation_results FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_reconciliation_results' AND policyname='Authenticated users can manage reconciliation') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage reconciliation" ON sched_reconciliation_results FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D6. sched_import_snapshots ──
ALTER TABLE sched_import_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_import_snapshots' AND policyname='Authenticated users can read snapshots') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read snapshots" ON sched_import_snapshots FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_import_snapshots' AND policyname='Authenticated users can manage snapshots') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage snapshots" ON sched_import_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_import_snapshots' AND policyname='Anon can read import snapshots') THEN
    EXECUTE 'CREATE POLICY "Anon can read import snapshots" ON sched_import_snapshots FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_import_snapshots' AND policyname='Anon can manage import snapshots') THEN
    EXECUTE 'CREATE POLICY "Anon can manage import snapshots" ON sched_import_snapshots FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D7. sched_match_rejections ──
ALTER TABLE sched_match_rejections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_match_rejections' AND policyname='Authenticated users can read rejections') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can read rejections" ON sched_match_rejections FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_match_rejections' AND policyname='Authenticated users can manage rejections') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can manage rejections" ON sched_match_rejections FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_match_rejections' AND policyname='Anon can read match rejections') THEN
    EXECUTE 'CREATE POLICY "Anon can read match rejections" ON sched_match_rejections FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_match_rejections' AND policyname='Anon can manage match rejections') THEN
    EXECUTE 'CREATE POLICY "Anon can manage match rejections" ON sched_match_rejections FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D8. sched_csv_imports — explicit anon policy ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_csv_imports' AND policyname='Anon can manage csv imports') THEN
    EXECUTE 'CREATE POLICY "Anon can manage csv imports" ON sched_csv_imports FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;


-- ── D9. sched_appointment_events — anon audit log access ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_events' AND policyname='Anon can read appointment events') THEN
    EXECUTE 'CREATE POLICY "Anon can read appointment events" ON sched_appointment_events FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sched_appointment_events' AND policyname='Anon can insert appointment events') THEN
    EXECUTE 'CREATE POLICY "Anon can insert appointment events" ON sched_appointment_events FOR INSERT TO anon WITH CHECK (true)';
  END IF;
END $$;


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION E: UNIQUE CONSTRAINT FOR IMPORT UPSERT                           ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- Required by import-boundary.ts: .upsert(..., { onConflict: "work_order_number" })
--
-- If duplicate work_order_numbers exist, the CREATE UNIQUE INDEX will fail.
-- This block deduplicates first: for each duplicated WO#, keep the row with
-- the most recent updated_at and delete the rest. Then create the index.
DO $$
DECLARE
  _dup_count integer;
BEGIN
  -- Skip if index already exists
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uq_work_orders_wo_number'
  ) THEN
    RAISE NOTICE 'uq_work_orders_wo_number already exists — skipping';
    RETURN;
  END IF;

  -- Count duplicate WO numbers
  SELECT count(*) INTO _dup_count
  FROM (
    SELECT work_order_number
    FROM work_orders
    WHERE work_order_number IS NOT NULL
    GROUP BY work_order_number
    HAVING count(*) > 1
  ) dups;

  IF _dup_count > 0 THEN
    RAISE NOTICE 'Deduplicating % work_order_number(s) — keeping most recent row for each', _dup_count;

    -- Delete older duplicates, keep the one with the latest updated_at (ties broken by id)
    DELETE FROM work_orders w
    USING (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY work_order_number
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM work_orders
        WHERE work_order_number IS NOT NULL
      ) ranked
      WHERE ranked.rn > 1
    ) dupes
    WHERE w.id = dupes.id;
  END IF;

  -- Now safe to create the unique index
  CREATE UNIQUE INDEX uq_work_orders_wo_number
    ON work_orders (work_order_number);
END $$;


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ DONE                                                                     ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
-- All tables, columns, indexes, constraints, and RLS policies are now current.
-- This script is safe to re-run at any time.
