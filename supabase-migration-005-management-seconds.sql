-- Add 'second' and 'management' crew types, plus manages and primary_crew_id columns

-- Update the crew_type CHECK constraint to include all types
ALTER TABLE sched_crews DROP CONSTRAINT IF EXISTS sched_crews_crew_type_check;
ALTER TABLE sched_crews ADD CONSTRAINT sched_crews_crew_type_check
  CHECK (crew_type IN ('measure_tech', 'install_in_house', 'install_sub', 'jip', 'svc', 'second', 'management', 'misc'));

-- Add manages column (array of department strings for management crew type)
ALTER TABLE sched_crews ADD COLUMN IF NOT EXISTS manages TEXT[] DEFAULT '{}';

-- Add primary_crew_id for seconds (references the crew they are second to)
ALTER TABLE sched_crews ADD COLUMN IF NOT EXISTS primary_crew_id UUID REFERENCES sched_crews(id) ON DELETE SET NULL;

-- Add additional_types for resources that serve multiple roles
ALTER TABLE sched_crews ADD COLUMN IF NOT EXISTS additional_types TEXT[] DEFAULT '{}';
