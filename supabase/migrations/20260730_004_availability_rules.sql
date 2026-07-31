-- Migration: Recurring Availability & Time Off
-- App-owned availability rules and exceptions (does not modify external time_off_requests)

create table if not exists sched_availability_rules (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references sched_crews(id) on delete cascade,
  kind text not null check (kind in ('pto', 'unavailable', 'role_assignment', 'block')),
  department text,
  start_time time,
  end_time time,
  weekdays integer[] default '{}',
  effective_start date not null,
  effective_end date,
  reason text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_availability_crew
  on sched_availability_rules(crew_id);

create index if not exists idx_availability_effective
  on sched_availability_rules(effective_start, effective_end);

create table if not exists sched_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references sched_availability_rules(id) on delete cascade,
  exception_date date not null,
  action text not null default 'skip' check (action in ('skip', 'modify')),
  override_start_time time,
  override_end_time time,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_avail_exceptions_rule
  on sched_availability_exceptions(rule_id);

-- RLS
alter table sched_availability_rules enable row level security;
alter table sched_availability_exceptions enable row level security;

create policy "Authenticated users can read availability"
  on sched_availability_rules for select
  to authenticated
  using (true);

create policy "Schedulers can manage availability"
  on sched_availability_rules for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can read exceptions"
  on sched_availability_exceptions for select
  to authenticated
  using (true);

create policy "Schedulers can manage exceptions"
  on sched_availability_exceptions for all
  to authenticated
  using (true)
  with check (true);
