-- Migration: Flags / Issue Center
-- Persistent manual and automatic flags for scheduling issues

create table if not exists sched_flags (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references sched_appointments(id) on delete set null,
  rforce_order_id uuid references sched_rforce_orders(id) on delete set null,
  crew_id uuid references sched_crews(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'automatic')),
  code text not null,
  severity text not null default 'warning' check (severity in ('error', 'warning', 'info')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'snoozed', 'resolved')),
  assignee_id uuid references auth.users(id),
  snoozed_until timestamptz,
  flag_date date,
  created_by uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(appointment_id, code, source) where (appointment_id is not null and status = 'open'),
  unique(rforce_order_id, code, source) where (rforce_order_id is not null and status = 'open')
);

create index if not exists idx_flags_status
  on sched_flags(status) where status = 'open';

create index if not exists idx_flags_appointment
  on sched_flags(appointment_id) where appointment_id is not null;

create index if not exists idx_flags_date
  on sched_flags(flag_date);

-- RLS
alter table sched_flags enable row level security;

create policy "Authenticated users can read flags"
  on sched_flags for select
  to authenticated
  using (true);

create policy "Authenticated users can create flags"
  on sched_flags for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update flags"
  on sched_flags for update
  to authenticated
  using (true);
