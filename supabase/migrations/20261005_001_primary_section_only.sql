-- Show a multi-department resource in one section only.
--
-- A resource who works several departments gets a row in each section their
-- types cover. For some people that is the point (you want to see the measure
-- tech's whole day in the measure grid); for others it is just three copies of
-- the same row. This flag collapses them to a single row in the section their
-- crew_type names, while that one row still carries every work order of every
-- type.
--
-- Shared, not per-user: a scheduler toggling this changes the calendar for
-- everyone, the same way crew.color is the shared default.

ALTER TABLE sched_crews
  ADD COLUMN IF NOT EXISTS primary_section_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sched_crews.primary_section_only IS
  'When true, this resource appears only in the section their crew_type names, '
  'even when additional_types would place them in others. That single row still '
  'shows every work order assigned to them, with out-of-department work flagged.';
