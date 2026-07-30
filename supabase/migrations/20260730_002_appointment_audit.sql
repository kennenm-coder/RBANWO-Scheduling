-- Migration: Appointment Audit & Cancellation
-- Adds audit columns to sched_appointments and sched_appointment_events table

alter table sched_appointments
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists last_rescheduled_at timestamptz;

create table if not exists sched_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references sched_appointments(id) on delete cascade,
  action text not null check (action in (
    'created', 'updated', 'rescheduled', 'cancelled', 'restored',
    'helper_added', 'helper_removed', 'linked', 'flagged'
  )),
  actor_id uuid references auth.users(id),
  actor_name_snapshot text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appt_events_appointment
  on sched_appointment_events(appointment_id);

create index if not exists idx_appt_events_created
  on sched_appointment_events(created_at desc);

-- RLS
alter table sched_appointment_events enable row level security;

create policy "Authenticated users can read events"
  on sched_appointment_events for select
  to authenticated
  using (true);

create policy "Authenticated users can insert events"
  on sched_appointment_events for insert
  to authenticated
  with check (true);
