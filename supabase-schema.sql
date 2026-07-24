-- RBANWO Scheduling App — Database Schema
-- Run this in Supabase SQL Editor (same database as Duck Force)
-- All tables prefixed with sched_ to avoid conflicts

-- Crew members
CREATE TABLE sched_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  crew_type TEXT NOT NULL CHECK (crew_type IN (
    'measure_tech', 'install_in_house', 'install_sub', 'jip', 'svc'
  )),
  color TEXT NOT NULL DEFAULT '#1a73e8',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Core scheduling table
CREATE TABLE sched_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id UUID NOT NULL REFERENCES sched_crews(id),
  secondary_crew_id UUID REFERENCES sched_crews(id),
  appointment_type TEXT NOT NULL CHECK (appointment_type IN (
    'tech_measure', 'install', 'service', 'jip'
  )),
  order_number TEXT,
  work_order_number TEXT,
  customer_name TEXT NOT NULL,
  address TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 1,
  time_block TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'confirmed', 'in_progress', 'complete', 'cancelled', 'rescheduled'
  )),
  notes TEXT,
  reschedule_reason TEXT,
  product_count INTEGER,
  salesforce_url TEXT,
  scheduled_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent double-booking at database level
CREATE UNIQUE INDEX idx_no_double_book
ON sched_appointments(crew_id, scheduled_date, time_block)
WHERE status != 'cancelled';

-- Fast lookups
CREATE INDEX idx_sched_appt_date ON sched_appointments(scheduled_date);
CREATE INDEX idx_sched_appt_crew_date ON sched_appointments(crew_id, scheduled_date);
CREATE INDEX idx_sched_appt_order ON sched_appointments(order_number);
CREATE INDEX idx_sched_appt_wo ON sched_appointments(work_order_number);

-- CSV import audit trail
CREATE TABLE sched_csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT,
  row_count INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('power_automate', 'manual_upload')),
  imported_by TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Imported rForce work orders (from CSV)
CREATE TABLE sched_rforce_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  work_order_number TEXT NOT NULL,
  status TEXT,
  appointment_status TEXT,
  customer_name TEXT,
  address TEXT,
  booking_date TIMESTAMPTZ,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  work_order_type TEXT,
  order_owner TEXT,
  sales_rep TEXT,
  installer TEXT,
  contact_name TEXT,
  email TEXT,
  phones JSONB,
  product_count INTEGER,
  csv_import_id UUID REFERENCES sched_csv_imports(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sched_rforce_order_num ON sched_rforce_orders(order_number);

-- App settings
CREATE TABLE sched_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Realtime on appointments for live collaboration
ALTER PUBLICATION supabase_realtime ADD TABLE sched_appointments;

-- Seed crew data
INSERT INTO sched_crews (name, crew_type, color, notes, sort_order) VALUES
  ('Ryan', 'measure_tech', '#f59e0b', 'Office Wed, Late Day Thu', 1),
  ('Nate', 'measure_tech', '#d97706', 'Office Thu, Late Day Tue', 2),
  ('Aaron', 'measure_tech', '#b45309', 'Special cases, bays/bows', 3),
  ('Sam Mormon', 'install_in_house', '#2563eb', NULL, 10),
  ('Keith Morris', 'install_in_house', '#1d4ed8', NULL, 11),
  ('Trevor Holewinaki', 'install_in_house', '#1e40af', NULL, 12),
  ('Ken Driebergen', 'install_in_house', '#1e3a8a', NULL, 13),
  ('Logan Dotson', 'install_in_house', '#3b82f6', NULL, 14),
  ('Morgan Michalak', 'install_in_house', '#60a5fa', NULL, 15),
  ('Tim Fitzpatrick', 'install_in_house', '#93c5fd', NULL, 16),
  ('Randy Taylor', 'install_sub', '#059669', NULL, 20),
  ('Alex Taylor', 'install_sub', '#047857', NULL, 21),
  ('Tom Snyder', 'install_sub', '#065f46', NULL, 22),
  ('Shane Grounds', 'install_sub', '#064e3b', NULL, 23),
  ('Josh Maas', 'jip', '#7c3aed', NULL, 30),
  ('Todd Williams', 'jip', '#6d28d9', 'Flex', 31),
  ('Matt Morgan', 'svc', '#e11d48', NULL, 40),
  ('Josh McIntyre', 'svc', '#be123c', NULL, 41);
