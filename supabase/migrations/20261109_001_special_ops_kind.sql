-- Special assignments: a manager drags "Special Ops" or "Office Day" from the
-- queue onto a crew's day to block that crew (e.g. a winter weather standby).
--
-- "office_day" already exists as an availability kind. This adds "special_ops".
-- Both are stored as one-day, full-day sched_availability_rules
-- (effective_start = effective_end, no weekdays, no times), so they reuse the
-- existing blocking, override-on-booking, conflict-guard and floaters logic.
--
-- Safe to re-run.

ALTER TABLE sched_availability_rules
  DROP CONSTRAINT IF EXISTS sched_availability_rules_kind_check;

ALTER TABLE sched_availability_rules
  ADD CONSTRAINT sched_availability_rules_kind_check
  CHECK (kind IN (
    'pto', 'unavailable', 'role_assignment', 'block',
    'late_day', 'office_day', 'special_ops'
  ));
