-- 2026-10-08: stop sched_publish_day_crews from being callable over the API.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase
-- exposes every function in the `public` schema through PostgREST. That made
-- sched_publish_day_crews(text) — which is SECURITY DEFINER, so it runs with
-- the owner's rights on work_orders — callable by an ANONYMOUS client holding
-- only the publishable key:
--
--   POST /rest/v1/rpc/sched_publish_day_crews  {"p_wo": "..."}
--
-- The blast radius was small (it only recomputes work_orders.day_crews from
-- data that already exists, and is idempotent), so this is hardening rather
-- than an incident. But a definer function reachable by anon is exactly the
-- shape of a real privilege-escalation bug, and the next definer function
-- someone adds here might not be harmless.
--
-- The triggers are unaffected: trg_sched_appointments_publish_day_crews and
-- trg_sched_crews_republish_day_crews call this from trigger functions running
-- as the scheduler who made the change, and schedulers are `authenticated`.
--
-- sched_day_crews_map() is left alone: SECURITY INVOKER, so a caller sees only
-- what their own RLS policies already allow.
--
-- sched_sync_install_tally() and sched_build_install_tally() (migration
-- 20261008_001) need nothing here — the first RETURNS TRIGGER, which PostgREST
-- cannot call, and the second is SECURITY INVOKER.
--
-- Idempotent. Safe to re-run.

REVOKE ALL ON FUNCTION public.sched_publish_day_crews(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sched_publish_day_crews(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sched_publish_day_crews(text) TO authenticated;

COMMENT ON FUNCTION public.sched_publish_day_crews(text) IS
  'Recompute work_orders.day_crews for one work order. SECURITY DEFINER; EXECUTE revoked from PUBLIC/anon so it is not callable over PostgREST by anonymous clients (2026-10-08). Called by the sched_appointments and sched_crews triggers.';

-- Verify (expects authenticated only, no PUBLIC/anon):
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name = 'sched_publish_day_crews';
