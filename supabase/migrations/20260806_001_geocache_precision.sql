-- Migration: Add precision tracking to geocode cache
-- Fixes table name mismatch (was sched_geocache, actual is sched_geocode_cache)

alter table sched_geocode_cache
  add column if not exists precision text default 'unknown'
    check (precision in ('rooftop', 'street', 'zip', 'unknown')),
  add column if not exists provider text,
  add column if not exists manual_override boolean default false,
  add column if not exists updated_at timestamptz default now();

-- Index for finding zip-level results that need refinement
create index if not exists idx_geocache_precision
  on sched_geocode_cache (precision)
  where precision != 'rooftop';
