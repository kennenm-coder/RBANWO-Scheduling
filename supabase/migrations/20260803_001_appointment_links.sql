-- Phase 1: Proper appointment link table with uniqueness constraints
-- Replaces the loose work_order_number-on-appointment linking approach

create table if not exists sched_appointment_links (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references sched_appointments(id) on delete cascade,
  source_system text not null default 'rforce',
  external_key text not null,
  work_order_number text,
  order_number text,
  match_method text not null default 'manual',
  linked_by uuid,
  linked_at timestamptz not null default now(),
  unlinked_by uuid,
  unlinked_at timestamptz,
  unlink_reason text,
  created_at timestamptz not null default now()
);

-- Only one active link per appointment
create unique index if not exists uq_active_link_appointment
  on sched_appointment_links (appointment_id)
  where unlinked_at is null;

-- Only one active link per rForce record
create unique index if not exists uq_active_link_external
  on sched_appointment_links (source_system, external_key)
  where unlinked_at is null;

-- Fast lookup by external key
create index if not exists idx_links_external_key
  on sched_appointment_links (source_system, external_key);

-- Fast lookup for active links
create index if not exists idx_links_active
  on sched_appointment_links (appointment_id)
  where unlinked_at is null;

-- Enable realtime
alter publication supabase_realtime add table sched_appointment_links;
