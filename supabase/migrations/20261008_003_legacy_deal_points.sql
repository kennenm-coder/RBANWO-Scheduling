-- ============================================================
-- Legacy deal points
--
-- Installs with no material list ("legacy deals") were excluded from the
-- utilization ratio entirely — the day came out of both numerator and
-- denominator. That was the right call while the alternative was scoring them
-- zero, but it meant an installer carrying mostly older work showed blank
-- instead of busy, which is useless on a tab for spotting who is light.
--
-- They are now ESTIMATED instead of excluded: a legacy deal is worth
-- legacy_points_per_day for every day it runs. At the default 6 against a
-- 12-point day, a legacy day reads as half full — deliberately conservative,
-- so a legacy-heavy installer leans toward being flagged rather than hidden.
--
-- The app marks every estimated day and still lists the job under missing
-- material lists, so an estimate is never mistaken for a product count.
--
-- Additive: one nullable-with-default column on a table only this feature
-- reads. Nothing else in any app touches it.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE sched_utilization_settings
  ADD COLUMN IF NOT EXISTS legacy_points_per_day NUMERIC(5,2) NOT NULL DEFAULT 6
    CHECK (legacy_points_per_day >= 0);

COMMENT ON COLUMN sched_utilization_settings.legacy_points_per_day IS
  'Points credited per day to an install with no material list. Default 6 against a 12-point day = half a day. Set to 0 to score legacy deals as no work; there is no longer an "exclude" option.';

COMMIT;

-- Verify (run separately):
--   SELECT target_points_per_day, goal_utilization_pct, legacy_points_per_day
--     FROM sched_utilization_settings;
--
-- Rollback:
--   ALTER TABLE sched_utilization_settings DROP COLUMN IF EXISTS legacy_points_per_day;
