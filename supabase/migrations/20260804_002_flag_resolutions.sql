-- Track resolved flags in IssueCenter.
-- flag_key matches the deterministic id produced by detectFlags().
create table sched_flag_resolutions (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  resolved_by text,
  resolved_at timestamptz not null default now(),
  notes text
);

create unique index uq_flag_resolution on sched_flag_resolutions (flag_key);
