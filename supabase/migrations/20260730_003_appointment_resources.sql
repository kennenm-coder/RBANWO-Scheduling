-- Migration: Multiple Assigned Resources
-- Adds sched_appointment_resources for Primary/Second/Third/Helper roles

create table if not exists sched_appointment_resources (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references sched_appointments(id) on delete cascade,
  crew_id uuid not null references sched_crews(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary', 'second', 'third', 'helper')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  unique(appointment_id, crew_id, role)
);

create index if not exists idx_appt_resources_appointment
  on sched_appointment_resources(appointment_id);

create index if not exists idx_appt_resources_crew
  on sched_appointment_resources(crew_id);

-- Backfill existing primary crew assignments
insert into sched_appointment_resources (appointment_id, crew_id, role)
select id, crew_id, 'primary'
from sched_appointments
where crew_id is not null
on conflict do nothing;

-- Backfill existing secondary crew assignments
insert into sched_appointment_resources (appointment_id, crew_id, role)
select id, secondary_crew_id, 'second'
from sched_appointments
where secondary_crew_id is not null
on conflict do nothing;

-- Backfill existing tertiary crew assignments
insert into sched_appointment_resources (appointment_id, crew_id, role)
select id, tertiary_crew_id, 'third'
from sched_appointments
where tertiary_crew_id is not null
on conflict do nothing;

-- RLS
alter table sched_appointment_resources enable row level security;

create policy "Authenticated users can read resources"
  on sched_appointment_resources for select
  to authenticated
  using (true);

create policy "Schedulers can manage resources"
  on sched_appointment_resources for all
  to authenticated
  using (true)
  with check (true);
