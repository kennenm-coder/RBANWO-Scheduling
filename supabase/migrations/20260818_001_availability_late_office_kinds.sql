-- Add "late_day" and "office_day" as label-only availability rule kinds.
-- These are display tags in the resource Type dropdown; they do not affect
-- scheduling/availability logic.

ALTER TABLE sched_availability_rules
  DROP CONSTRAINT IF EXISTS sched_availability_rules_kind_check;

ALTER TABLE sched_availability_rules
  ADD CONSTRAINT sched_availability_rules_kind_check
  CHECK (kind IN ('pto', 'unavailable', 'role_assignment', 'block', 'late_day', 'office_day'));
