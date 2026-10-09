-- ============================================================
-- Legacy deals: estimate from the unit count when there is one
--
-- A legacy deal (install with no material list) was scored at a flat
-- legacy_points_per_day. That is reasonable for an unknown small job and badly
-- wrong for a known large one.
--
-- Live example: order 04761892, Tim Paradiso -- 92 units over 5 days, no
-- material list. Scored at 6 points a day it counted as roughly an eighth of
-- its real weight, and it dominated two installers' ranges (Sam Morman as
-- lead, Morgan Michalak as helper).
--
-- sched_appointments.product_count already carries a unit count for most of
-- these -- it is what the calendar tile prints as "92 units". Converting it at
-- a points-per-unit rate is far closer to the truth than a flat day.
--
-- 2.8 is this company's own average, measured from the 385 material lists in
-- install_docs on 2026-10-08: 1816 units scoring ~5137 points.
--
--   1007 insert windows x 2    = 2014
--    551 full-frame windows x 3 = 1653
--     29 specialty (~3.5)       =  102
--     98 patio doors x 6        =  588
--    130 entry doors x 6        =  780
--      1 storm door x 2         =    2
--                                 -----
--                                  5139 / 1816 units = 2.83
--
-- The flat per-day rate stays as the fallback for legacy deals with no unit
-- count. Set this to 0 to go back to always using the per-day rate.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE sched_utilization_settings
  ADD COLUMN IF NOT EXISTS legacy_points_per_unit NUMERIC(5,2) NOT NULL DEFAULT 2.8
    CHECK (legacy_points_per_unit >= 0);

COMMENT ON COLUMN sched_utilization_settings.legacy_points_per_unit IS
  'Points per unit when estimating a legacy deal from sched_appointments.product_count. 2.8 = this company''s measured average (1816 units / ~5137 points, 2026-10-08). Falls back to legacy_points_per_day when a job has no unit count. Set to 0 to always use the per-day rate.';

COMMIT;

-- Verify (run separately):
--   SELECT target_points_per_day, goal_utilization_pct,
--          legacy_points_per_day, legacy_points_per_unit
--     FROM sched_utilization_settings;
--
-- How many legacy deals will actually benefit (non-zero product_count):
--   SELECT count(*) FILTER (WHERE a.product_count > 0) AS have_a_unit_count,
--          count(*) FILTER (WHERE coalesce(a.product_count,0) = 0) AS fall_back_to_per_day
--     FROM sched_appointments a
--     LEFT JOIN sched_install_tally t ON t.order_number = a.order_number
--    WHERE a.appointment_type = 'install'
--      AND a.status IN ('scheduled','confirmed','in_progress','complete')
--      AND t.order_number IS NULL;
--
-- Rollback:
--   ALTER TABLE sched_utilization_settings DROP COLUMN IF EXISTS legacy_points_per_unit;
