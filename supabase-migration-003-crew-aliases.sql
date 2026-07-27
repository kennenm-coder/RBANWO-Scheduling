-- Add aliases column to sched_crews for nickname matching (e.g. Tim / Timothy)
ALTER TABLE sched_crews ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';
