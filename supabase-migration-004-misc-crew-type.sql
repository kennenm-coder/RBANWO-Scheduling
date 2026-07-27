-- Add 'misc' as a valid crew_type for non-field employees (office staff, etc.)
ALTER TABLE sched_crews DROP CONSTRAINT IF EXISTS sched_crews_crew_type_check;
ALTER TABLE sched_crews ADD CONSTRAINT sched_crews_crew_type_check
  CHECK (crew_type IN ('measure_tech', 'install_in_house', 'install_sub', 'jip', 'svc', 'misc'));
