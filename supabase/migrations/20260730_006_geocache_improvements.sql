-- Migration: Geocache precision & validation
-- Adds validation fields to the geocode cache table

do $$
begin
  -- Only run if sched_geocache table exists
  if exists (select 1 from information_schema.tables where table_name = 'sched_geocache') then
    alter table sched_geocache
      add column if not exists state text,
      add column if not exists precision text default 'unknown'
        check (precision in ('rooftop', 'street', 'zip', 'unknown')),
      add column if not exists provider text,
      add column if not exists validation_status text default 'pending'
        check (validation_status in ('valid', 'invalid', 'pending', 'reviewed')),
      add column if not exists validation_message text,
      add column if not exists reviewed_by uuid references auth.users(id),
      add column if not exists updated_at timestamptz default now();
  end if;
end $$;
