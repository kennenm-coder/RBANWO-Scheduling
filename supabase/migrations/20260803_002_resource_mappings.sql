-- Phase 1: Resource name mappings — replaces first-name guessing
-- Maps exact rForce resource names to app crew IDs

create table if not exists sched_resource_mappings (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null,
  crew_id uuid not null references sched_crews(id) on delete cascade,
  is_active boolean not null default true,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_resource_mapping_name
  on sched_resource_mappings (lower(raw_name))
  where is_active = true;

create index if not exists idx_resource_mappings_crew
  on sched_resource_mappings (crew_id)
  where is_active = true;
