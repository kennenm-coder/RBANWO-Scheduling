-- ============================================================================
-- RBANWO Scheduling App — Authoritative Database Schema
-- ============================================================================
--
-- This file is the SINGLE SOURCE OF TRUTH for the expected database state.
-- It represents every table, column, index, constraint, and RLS policy that
-- the live Supabase database should have after all migrations are applied.
--
-- DO NOT run this file to create a fresh database — it exists as a reference.
-- Actual changes are applied via individual migrations in supabase/migrations/.
--
-- When adding a new column or table:
--   1. Write a migration in supabase/migrations/ with the ALTER/CREATE
--   2. Update this file to reflect the new state
--   3. Remove any "column may not exist" defensive code in the app
--
-- Table naming: all app-owned tables use the `sched_` prefix.
-- Shared tables (work_orders, time_off_requests) belong to Duck Force and
-- are read-only from this app's perspective.
--
-- Last updated: 2026-08-12  (Phases 6/8/9/12 — import boundary, RLS gaps, import snapshots)
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 1: ACTIVELY USED TABLES                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ── 1.1  sched_crews ──
-- Crew members / resources. Calendar card colors come from crew.color.

CREATE TABLE sched_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  crew_type TEXT NOT NULL CHECK (crew_type IN (
    'measure_tech', 'install_in_house', 'install_sub',
    'jip', 'svc', 'second', 'management', 'misc'
  )),
  color TEXT NOT NULL DEFAULT '#1a73e8',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  aliases TEXT[] DEFAULT '{}',                -- nickname matching (e.g. Tim / Timothy)
  manages TEXT[] DEFAULT '{}',                -- department list for management crew_type
  primary_crew_id UUID REFERENCES sched_crews(id) ON DELETE SET NULL,  -- for 'second' type
  additional_types TEXT[] DEFAULT '{}',        -- resources that serve multiple roles
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 1.2  sched_appointments ──
-- Core scheduling table. THE source of truth for what is on the calendar.
-- Appointment IDs are permanent — never delete and recreate.

CREATE TABLE sched_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Crew assignments (nullable when status = 'unscheduled')
  crew_id UUID REFERENCES sched_crews(id),
  secondary_crew_id UUID REFERENCES sched_crews(id),
  tertiary_crew_id UUID REFERENCES sched_crews(id),

  -- Appointment details
  appointment_type TEXT NOT NULL CHECK (appointment_type IN (
    'tech_measure', 'install', 'service', 'jip',
    'lswp', 'hoa', 'paint_stain', 'job_site_visit', 'collections'
  )),
  order_number TEXT,
  work_order_number TEXT,
  customer_name TEXT NOT NULL,
  address TEXT NOT NULL,

  -- Scheduling (nullable when status = 'unscheduled')
  scheduled_date DATE,
  start_time TIME,
  end_time TIME,
  duration_days INTEGER NOT NULL DEFAULT 1,
  time_block TEXT,
  time_block_end TEXT,              -- end block for multi-block spans (drag resize)

  -- Status & workflow
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'confirmed', 'in_progress', 'complete',
    'cancelled', 'rescheduled', 'unscheduled'
  )),
  notes TEXT,
  reschedule_reason TEXT,
  product_count INTEGER,
  salesforce_url TEXT,
  scheduled_by TEXT,

  -- Override tracking
  manual_override BOOLEAN NOT NULL DEFAULT false,
  override_source JSONB,            -- snapshot of original rForce values at override time
  merge_source_wo TEXT,             -- WO number this appointment was merged from

  -- Optimistic concurrency
  version INTEGER NOT NULL DEFAULT 1,

  -- Audit columns
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  last_rescheduled_at TIMESTAMPTZ,

  -- Sync model (Phase 2a)
  origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'rforce_approved', 'merged')),
  sync_state TEXT NOT NULL DEFAULT 'manual_awaiting_rforce'
    CHECK (sync_state IN (
      'manual_awaiting_rforce',
      'match_suggested',
      'linked_pending_confirmation',
      'waiting_for_import',
      'in_sync',
      'source_missing',
      'ambiguous_match',
      'conflict'
    )),
  original_entry_snapshot JSONB,     -- immutable record of scheduler's original entry
  last_reconciled_import_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Scheduling fields required unless unscheduled
  CONSTRAINT chk_scheduled_fields CHECK (
    status = 'unscheduled'
    OR (crew_id IS NOT NULL AND scheduled_date IS NOT NULL
        AND start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

-- Prevent double-booking (excludes cancelled and unscheduled)
CREATE UNIQUE INDEX idx_no_double_book
  ON sched_appointments(crew_id, scheduled_date, time_block)
  WHERE status NOT IN ('cancelled', 'unscheduled');

CREATE INDEX idx_sched_appt_date ON sched_appointments(scheduled_date);
CREATE INDEX idx_sched_appt_crew_date ON sched_appointments(crew_id, scheduled_date);
CREATE INDEX idx_sched_appt_order ON sched_appointments(order_number);
CREATE INDEX idx_sched_appt_wo ON sched_appointments(work_order_number);


-- ── 1.3  sched_appointment_events ──
-- Audit trail for all appointment mutations.

CREATE TABLE sched_appointment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'created', 'updated', 'rescheduled', 'cancelled', 'restored',
    'helper_added', 'helper_removed', 'linked', 'flagged',
    'drag_moved', 'drag_resized', 'approved_from_rforce',
    'unscheduled', 'merged', 'sync_state_changed'
  )),
  actor_id UUID REFERENCES auth.users(id),
  actor_name_snapshot TEXT,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appt_events_appointment ON sched_appointment_events(appointment_id);
CREATE INDEX idx_appt_events_created ON sched_appointment_events(created_at DESC);


-- ── 1.4  sched_appointment_links ──
-- Links between app appointments and external systems (rForce).
-- One active link per appointment; one active link per rForce record.

CREATE TABLE sched_appointment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'rforce',
  external_key TEXT NOT NULL,
  work_order_number TEXT,
  order_number TEXT,
  match_method TEXT NOT NULL DEFAULT 'manual',
  linked_by UUID,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_by UUID,
  unlinked_at TIMESTAMPTZ,
  unlink_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_active_link_appointment
  ON sched_appointment_links(appointment_id) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX uq_active_link_external
  ON sched_appointment_links(source_system, external_key) WHERE unlinked_at IS NULL;
CREATE INDEX idx_links_external_key ON sched_appointment_links(source_system, external_key);
CREATE INDEX idx_links_active ON sched_appointment_links(appointment_id) WHERE unlinked_at IS NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE sched_appointment_links;


-- ── 1.5  sched_csv_imports ──
-- CSV import audit trail. Used by the import pipeline.
-- NOTE: The actual table name is sched_csv_imports (with sched_ prefix).
-- Migration 005 incorrectly referenced 'csv_imports' without prefix.

CREATE TABLE sched_csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT,
  row_count INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('power_automate', 'manual_upload')),
  imported_by TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT,                -- SHA-256 for duplicate detection
  order_count INTEGER,
  changed_count INTEGER,
  new_count INTEGER
);


-- ── 1.6  sched_availability_rules ──
-- Recurring availability / PTO / blocks. App-owned.

CREATE TABLE sched_availability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id UUID NOT NULL REFERENCES sched_crews(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pto', 'unavailable', 'role_assignment', 'block')),
  department TEXT,
  start_time TIME,
  end_time TIME,
  weekdays INTEGER[] DEFAULT '{}',
  repeat_interval INTEGER NOT NULL DEFAULT 1,  -- 1=weekly, 2=biweekly, etc.
  effective_start DATE NOT NULL,
  effective_end DATE,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_availability_crew ON sched_availability_rules(crew_id);
CREATE INDEX idx_availability_effective ON sched_availability_rules(effective_start, effective_end);


-- ── 1.7  sched_availability_exceptions ──
-- Per-date exceptions to recurring rules.

CREATE TABLE sched_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES sched_availability_rules(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  action TEXT NOT NULL DEFAULT 'skip' CHECK (action IN ('skip', 'modify')),
  override_start_time TIME,
  override_end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_avail_exceptions_rule ON sched_availability_exceptions(rule_id);


-- ── 1.8  sched_geocode_cache ──
-- One row per unique address, lat/lng from geocoding API.

CREATE TABLE sched_geocode_cache (
  address_hash TEXT PRIMARY KEY,
  address_original TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  state TEXT,
  precision TEXT DEFAULT 'unknown'
    CHECK (precision IN ('rooftop', 'street', 'zip', 'unknown')),
  provider TEXT,
  validation_status TEXT DEFAULT 'pending'
    CHECK (validation_status IN ('valid', 'invalid', 'pending', 'reviewed')),
  validation_message TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  manual_override BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'nominatim',
  geocoded_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_geocode_address ON sched_geocode_cache(address_hash);
CREATE INDEX idx_geocache_precision ON sched_geocode_cache(precision)
  WHERE precision != 'rooftop';


-- ── 1.9  sched_resource_mappings ──
-- Maps exact rForce resource names to app crew IDs.

CREATE TABLE sched_resource_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name TEXT NOT NULL,
  crew_id UUID NOT NULL REFERENCES sched_crews(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_resource_mapping_name
  ON sched_resource_mappings(lower(raw_name)) WHERE is_active = true;
CREATE INDEX idx_resource_mappings_crew
  ON sched_resource_mappings(crew_id) WHERE is_active = true;


-- ── 1.10  sched_rforce_dismissals ──
-- Dismissed rForce approval prompts. Keyed on WO + date so re-scheduled orders re-trigger.

CREATE TABLE sched_rforce_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_number TEXT NOT NULL,
  rforce_date TEXT NOT NULL,
  rforce_start_time TEXT,
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE UNIQUE INDEX uq_dismissal_wo_date
  ON sched_rforce_dismissals(work_order_number, rforce_date);


-- ── 1.11  sched_flag_resolutions ──
-- Resolved flags in the Issue Center. flag_key matches detectFlags() output.

CREATE TABLE sched_flag_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE UNIQUE INDEX uq_flag_resolution ON sched_flag_resolutions(flag_key);


-- ── 1.12  sched_match_rejections ──
-- "Not a match" memory. Prevents the same fuzzy-match suggestion from reappearing.

CREATE TABLE sched_match_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
  work_order_number TEXT NOT NULL,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE UNIQUE INDEX uq_match_rejection
  ON sched_match_rejections(appointment_id, work_order_number);


-- ── 1.13  sched_profiles ──
-- User profiles (linked to auth.users). Used by auth.ts.

CREATE TABLE sched_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'scheduler'
    CHECK (role IN ('scheduler', 'manager', 'admin', 'read_only')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 1.14  sched_user_preferences ──
-- Per-user UI preferences. Used by preferences.ts.

CREATE TABLE sched_user_preferences (
  user_id UUID PRIMARY KEY REFERENCES sched_profiles(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  default_view TEXT NOT NULL DEFAULT 'week'
    CHECK (default_view IN ('day', 'week')),
  density TEXT NOT NULL DEFAULT 'comfortable'
    CHECK (density IN ('compact', 'comfortable')),
  department_filters JSONB DEFAULT '[]'::jsonb,
  color_overrides JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 1.15  sched_import_snapshots ──
-- Per-order data snapshot at each CSV import. Enables change-detection.
-- Wired up by Phase 6 (import-boundary.ts).

CREATE TABLE sched_import_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES sched_csv_imports(id) ON DELETE CASCADE,
  work_order_number TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  change_summary JSONB,               -- null if first seen; {field: {old, new}}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_snapshots_wo ON sched_import_snapshots(work_order_number);
CREATE INDEX idx_import_snapshots_import ON sched_import_snapshots(import_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 2: GHOST TABLES (created by migrations, not used by app)      ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  These tables exist in the live DB but no app code reads or writes     ║
-- ║  them. They were created for planned features that were either          ║
-- ║  implemented differently (client-side) or never wired up.              ║
-- ║                                                                        ║
-- ║  Decision: KEEP them (no data loss risk) but do not add new code       ║
-- ║  that depends on them until a phase specifically wires them in.         ║
-- ║                                                                        ║
-- ║  Ghost tables:                                                         ║
-- ║    sched_rforce_orders        — app reads shared work_orders instead   ║
-- ║    sched_flags                — flags computed client-side in flags.ts  ║
-- ║    sched_appointment_resources — app uses inline crew_id columns       ║
-- ║    sched_reconciliation_results — reconciliation is client-side        ║
-- ║    sched_settings             — no settings UI exists                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- (Ghost table definitions omitted — see their respective migration files.)


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 3: SHARED TABLES (owned by Duck Force, read-only from here)   ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  work_orders       — rForce CSV data imported by Power Automate        ║
-- ║  time_off_requests  — employee time-off (shared across apps)           ║
-- ║                                                                        ║
-- ║  These tables are NOT prefixed with sched_ and are NOT managed by      ║
-- ║  this app's migrations. Do not ALTER them here.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 4: ROW-LEVEL SECURITY                                         ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  Current policy: wide-open for both anon and authenticated.            ║
-- ║  The app is internal-only; ENFORCE_AUTH = false.                        ║
-- ║  Phase 13 will tighten this to authenticated-only.                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Base 5 tables: wide-open (original supabase-rls.sql)
ALTER TABLE sched_crews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_crews"
  ON sched_crews FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sched_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_appointments"
  ON sched_appointments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sched_csv_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_csv_imports"
  ON sched_csv_imports FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sched_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sched_settings"
  ON sched_settings FOR ALL USING (true) WITH CHECK (true);

-- Profiles: own-row update, admin manage, all read
ALTER TABLE sched_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read all profiles"
  ON sched_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile"
  ON sched_profiles FOR UPDATE TO authenticated USING (id = auth.uid());

ALTER TABLE sched_user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own preferences"
  ON sched_user_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can manage own preferences"
  ON sched_user_preferences FOR ALL TO authenticated USING (user_id = auth.uid());

-- Appointment events: authenticated read + insert; anon read + insert
ALTER TABLE sched_appointment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read events"
  ON sched_appointment_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert events"
  ON sched_appointment_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Anon can read appointment events"
  ON sched_appointment_events FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert appointment events"
  ON sched_appointment_events FOR INSERT TO anon WITH CHECK (true);

-- Links: authenticated + anon full access
ALTER TABLE sched_appointment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage links"
  ON sched_appointment_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage appointment links"
  ON sched_appointment_links FOR ALL TO anon USING (true) WITH CHECK (true);

-- Availability: authenticated + anon full access
ALTER TABLE sched_availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage availability"
  ON sched_availability_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage availability rules"
  ON sched_availability_rules FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE sched_availability_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage exceptions"
  ON sched_availability_exceptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage availability exceptions"
  ON sched_availability_exceptions FOR ALL TO anon USING (true) WITH CHECK (true);

-- Resource mappings: authenticated + anon full access
ALTER TABLE sched_resource_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage mappings"
  ON sched_resource_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage resource mappings"
  ON sched_resource_mappings FOR ALL TO anon USING (true) WITH CHECK (true);

-- Dismissals: authenticated + anon full access
ALTER TABLE sched_rforce_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage dismissals"
  ON sched_rforce_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage dismissals"
  ON sched_rforce_dismissals FOR ALL TO anon USING (true) WITH CHECK (true);

-- Import snapshots: authenticated + anon full access
ALTER TABLE sched_import_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage snapshots"
  ON sched_import_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage import snapshots"
  ON sched_import_snapshots FOR ALL TO anon USING (true) WITH CHECK (true);

-- Flag resolutions: authenticated + anon full access
ALTER TABLE sched_flag_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage resolutions"
  ON sched_flag_resolutions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage flag resolutions"
  ON sched_flag_resolutions FOR ALL TO anon USING (true) WITH CHECK (true);

-- Match rejections: authenticated + anon full access
ALTER TABLE sched_match_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read rejections"
  ON sched_match_rejections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage rejections"
  ON sched_match_rejections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage match rejections"
  ON sched_match_rejections FOR ALL TO anon USING (true) WITH CHECK (true);

-- Geocode cache: no RLS (no sensitive data, internal use only)


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 5: FUNCTIONS                                                  ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  approve_rforce_order() — atomic RPC for rForce approval               ║
-- ║  NOTE: store.ts currently bypasses this RPC and does direct INSERTs    ║
-- ║  because sync model columns weren't guaranteed to exist. Phase 1       ║
-- ║  fixes this — the RPC can be wired back in.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- See supabase/migrations/20260806_004_atomic_approve_rpc.sql for the
-- full function definition. It remains installed but unused.


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SECTION 6: REALTIME                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER PUBLICATION supabase_realtime ADD TABLE sched_appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE sched_appointment_links;
