-- Choose which rows a resource appears on.
--
-- Replaces primary_section_only (20261005_001), which could only say "one row,
-- the one your Type names". The type still decides what work someone is
-- ELIGIBLE for; this decides where they are DRAWN. A resource typed for
-- measures, service and JIPs can be shown on just the measure row, and that row
-- still carries all of their work with the other departments' jobs flagged.
--
-- NULL or empty means every section their types cover — the default, so nobody
-- changes until someone makes a choice. Shared across accounts, like crew.color.

ALTER TABLE sched_crews
  ADD COLUMN IF NOT EXISTS visible_sections TEXT[];

-- Carry over anyone already collapsed: "primary only" is just a selection of
-- the single section their crew_type names.
UPDATE sched_crews
SET visible_sections = ARRAY[
  CASE crew_type
    WHEN 'measure_tech'     THEN 'measure'
    WHEN 'install_in_house' THEN 'install'
    WHEN 'install_sub'      THEN 'install'
    WHEN 'svc'              THEN 'service'
    WHEN 'jip'              THEN 'jip'
  END
]
WHERE primary_section_only IS TRUE
  AND crew_type IN ('measure_tech', 'install_in_house', 'install_sub', 'svc', 'jip');

ALTER TABLE sched_crews
  DROP COLUMN IF EXISTS primary_section_only;

COMMENT ON COLUMN sched_crews.visible_sections IS
  'Which calendar sections this resource is drawn in (measure/install/service/jip). '
  'NULL or empty means every section their crew_type and additional_types cover. '
  'Affects display only - eligibility still comes from the types.';
