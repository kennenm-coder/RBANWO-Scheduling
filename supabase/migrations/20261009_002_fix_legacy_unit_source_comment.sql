-- ============================================================
-- Correct what legacy_points_per_unit is multiplied BY
--
-- Migration 20261009_001 documented this column as applying to
-- sched_appointments.product_count. That was wrong, and checking the data is
-- what showed it:
--
--   order 04761892 (Tim Paradiso)
--     appointments.product_count = 92
--     work_orders.total_units    = 23   (14 windows + 9 doors)
--
-- product_count counts LINE ITEMS -- hardware, accessories, and seemingly
-- every phase of the order -- not units to install. Multiplying it by the
-- per-unit rate inflated that job fourfold and rendered a perfectly plausible
-- 5-day week at 430% of capacity.
--
-- The app now reads work_orders.total_units instead. Coverage is unchanged
-- (323 of 596 legacy installs carry a breakdown, against 325 with a
-- product_count), so this costs nothing and fixes the values.
--
-- Comment only. No data or behaviour changes here; the fix is in the client.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

COMMENT ON COLUMN sched_utilization_settings.legacy_points_per_unit IS
  'Points per unit when estimating a legacy deal from work_orders.total_units (NOT appointments.product_count, which counts line items: order 04761892 is 92 vs 23 real units). 2.8 = measured average, 1816 units / ~5137 points. Falls back to legacy_points_per_day when rForce has no unit count. Set to 0 to always use the per-day rate.';
