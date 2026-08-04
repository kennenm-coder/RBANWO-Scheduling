-- Track dismissed rForce approval prompts.
-- Keyed on work_order_number + rforce_date so a moved order re-triggers approval.
create table sched_rforce_dismissals (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null,
  rforce_date text not null,
  rforce_start_time text,
  dismissed_by text,
  dismissed_at timestamptz not null default now(),
  reason text
);

create unique index uq_dismissal_wo_date
  on sched_rforce_dismissals (work_order_number, rforce_date);
