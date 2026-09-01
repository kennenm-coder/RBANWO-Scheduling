-- Migration: Company-Wide Calendar Blocks
-- Org-wide day blocks (holidays, all-office meetings, company closures) that
-- apply to EVERY crew at once. Unlike sched_availability_rules (per-crew), these
-- have no crew_id — they are fanned out to all crews at read time in
-- getCrewAvailability(). Whole-day when start_time/end_time are NULL; a time
-- window blocks only the overlapping blocks (e.g. a 10-11 all-office meeting).
-- Multi-day closures use end_date.

create table if not exists sched_calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('holiday', 'company_meeting')),
  start_date date not null,
  end_date date,                       -- NULL = single day
  start_time time,                     -- NULL (with end_time NULL) = whole day
  end_time time,
  reason text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_blocks_dates
  on sched_calendar_blocks(start_date, end_date);

-- RLS — mirrors sched_availability_rules in the authoritative schema: both the
-- authenticated and anon roles can read/manage (the app client runs as anon on
-- localhost/dev, where there is no Supabase auth session).
alter table sched_calendar_blocks enable row level security;

create policy "Authenticated can manage calendar blocks"
  on sched_calendar_blocks for all
  to authenticated
  using (true)
  with check (true);

create policy "Anon can manage calendar blocks"
  on sched_calendar_blocks for all
  to anon
  using (true)
  with check (true);
