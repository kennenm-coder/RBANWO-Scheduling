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

-- ── Also: keep the tally builder off the public API ────────────────────────
-- Same hardening as 20261008_002_revoke_definer_rpc. Postgres grants EXECUTE
-- on a new function to PUBLIC, and Supabase exposes every `public` function
-- through PostgREST, so migration 001 left this callable by an anonymous
-- client:
--
--   POST /rest/v1/rpc/sched_build_install_tally  {"p_doc": {...}}
--
-- It is NOT security definer and reads no data — it only classifies a jsonb
-- the caller supplies and hands back counts of what they sent — so there is
-- nothing to escalate or leak. Revoked anyway: a reachable function is API
-- surface nobody asked for, and the triggers and the backfill call it as the
-- table owner, so nothing in the app depends on the PUBLIC grant.
--
-- sched_sync_install_tally() needs no revoke: it returns `trigger`, and
-- PostgREST does not expose trigger functions as RPC.

BEGIN;

REVOKE ALL ON FUNCTION public.sched_build_install_tally(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sched_build_install_tally(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.sched_build_install_tally(jsonb) FROM authenticated;

COMMIT;

-- Verify (run separately) — expect no 'anon'/'authenticated'/'PUBLIC' entries:
--   SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('sched_build_install_tally','sched_sync_install_tally');
