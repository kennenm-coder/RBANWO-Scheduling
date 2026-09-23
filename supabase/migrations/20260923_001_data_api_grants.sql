-- ============================================================
-- Data API grants (scheduling tables)
--
-- On 2026-10-30 Supabase stops automatically granting Data API
-- access to NEW tables in the public schema. Tables that already
-- exist keep their grants, so this changes NOTHING about the live
-- database -- running it there is a no-op.
--
-- It matters for a rebuild: a new project, a preview branch, or a
-- local 'supabase db reset'. Without these grants the tables below
-- come back unreachable through the Data API ("permission denied")
-- even though their RLS policies are correct.
--
-- The grants match what the live database has today (verified
-- 2026-09-23 against information_schema.role_table_grants): every
-- public table grants full DML to anon, authenticated and
-- service_role, and RLS policies are the actual gate. A grant here
-- does NOT mean that role may read the data -- the policies decide.
--
-- Any NEW table added after 2026-10-30 needs its own grant block
-- in the same migration that creates it. Copy the pattern below.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

begin;

grant select, insert, update, delete on public.sched_appointment_events to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_appointment_links to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_appointment_resources to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_appointments to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_availability_exceptions to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_availability_rules to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_calendar_blocks to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_crews to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_csv_imports to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_flag_resolutions to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_flags to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_geocode_cache to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_import_runs to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_import_snapshots to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_match_rejections to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_profiles to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_reconciliation_results to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_resource_mappings to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_rforce_dismissals to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_rforce_orders to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_settings to anon, authenticated, service_role;
grant select, insert, update, delete on public.sched_user_preferences to anon, authenticated, service_role;

commit;

-- Verify (run separately) -- each table below should show all three
-- roles with SELECT/INSERT/UPDATE/DELETE:
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon','authenticated','service_role')
--    order by table_name, grantee;
