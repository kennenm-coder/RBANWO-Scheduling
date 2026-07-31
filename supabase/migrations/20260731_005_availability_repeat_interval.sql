-- Add repeat_interval for biweekly/triweekly recurring rules
-- 1 = every week (default), 2 = every other week, etc.
-- Anchor date is effective_start.

ALTER TABLE sched_availability_rules
  ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 1;
