-- ============================================================
-- Make this repo's RLS self-sufficient: remove the anon policies it creates.
--
-- THE PROBLEM THIS SOLVES IS A CROSS-REPO DEPENDENCY, not a live hole.
--
-- Production today is clean: every sched_* table has exactly one policy,
-- scheduling_roles_all_<table>, FOR ALL with
-- has_any_role(ARRAY['admin','scheduling','scheduling_manager']). Verified
-- 2026-10-20 — there are no anon policies on any sched_* table.
--
-- But four files in THIS repo still create wide-open anon policies:
--
--   supabase/schema.sql                                  (11 policies)
--   supabase/migrations/20260806_006_fix_availability_rules.sql
--   supabase/migrations/20260806_007_anon_rls_policies.sql
--   supabase/migrations/20260812_002_catchup_all_missing.sql
--
-- all of the shape:
--
--   CREATE POLICY "Anon can manage X" ON sched_X
--     FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- which means: anybody at all, including someone who never signed in, can
-- read and write that table. The anon key ships in the browser bundle, so
-- "anon" is the whole internet.
--
-- Those are currently neutralised by a migration in a DIFFERENT repository:
-- Betterthengooglecal/supabase/migrations/019_lock_down_shared_tables.sql
-- loops 20 sched_* tables, drops EVERY policy it finds on each (dynamically,
-- from pg_policies, so it catches these whatever they are named) and creates
-- the role-gated one. That is why production is clean.
--
-- The danger is the ordering assumption. Rebuild this repo's migrations
-- WITHOUT also running the calendar app's 019 — a fresh environment, a
-- staging copy, a restore, someone new following this repo's README — and the
-- anon policies stand, with nothing to undo them. Nothing in either repo
-- enforces that ordering; it exists only as prose in a comment.
--
-- Worse, 20260908_001_rls_lockdown_allowlist.sql in this repo *looks* like the
-- lockdown but is a no-op: its only statement is `SELECT 1;` and its header
-- says "Nothing to run from this file; it documents the change for this repo."
-- So reading this repo alone gives you the impression the tables are locked
-- down here. They are not.
--
-- This migration makes that assumption unnecessary: it drops the anon policies
-- and guarantees the role-gated policy exists, using only this repo. Running
-- it against current production changes nothing (the anon policies are already
-- gone and the role policies already exist) — it is a no-op that stays
-- correct on a rebuild.
--
-- It deliberately drops ONLY policies named 'Anon can %' rather than every
-- policy on the table the way 019 does. Dropping everything and recreating is
-- fine inside 019's transaction, but from this repo it would briefly discard
-- policies this repo does not own (sched_profiles, sched_crew_targets) and
-- recreate a weaker set. Narrow is safer here.
--
-- Idempotent. Safe to re-run.

-- ── Project guard: this file belongs to the SHARED RbA project ──────────────
-- (xusqjotoyntnfysquvlv — the calendar / scheduling / cut-list / TrimGauge
-- database). task-os has its own separate project. Fail loudly rather than
-- half-apply somewhere else.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'allowed_emails'
  ) then
    raise exception
      'WRONG DATABASE: public.allowed_emails is missing, so this is not the shared RbA project. Nothing was applied.';
  end if;
end $$;

do $$
declare
  t text;
  p record;
  dropped int := 0;
  created int := 0;
begin
  foreach t in array array[
    'sched_appointment_events', 'sched_appointment_links', 'sched_appointment_resources',
    'sched_appointments', 'sched_availability_exceptions', 'sched_availability_rules',
    'sched_calendar_blocks', 'sched_crews', 'sched_csv_imports', 'sched_flag_resolutions',
    'sched_flags', 'sched_geocode_cache', 'sched_import_runs', 'sched_import_snapshots',
    'sched_match_rejections', 'sched_reconciliation_results', 'sched_resource_mappings',
    'sched_rforce_dismissals', 'sched_rforce_orders', 'sched_settings'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I enable row level security', t);

      -- Drop the wide-open anon policies this repo's older files create.
      for p in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = t and policyname like 'Anon can %'
      loop
        execute format('drop policy if exists %I on public.%I', p.policyname, t);
        dropped := dropped + 1;
      end loop;

      -- Guarantee the role-gated policy exists, so dropping the anon ones can
      -- never leave a table with no way in.
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t
          and policyname = 'scheduling_roles_all_' || t
      ) then
        execute format(
          'create policy "scheduling_roles_all_%s" on public.%I for all
             using (public.has_any_role(array[''admin'',''scheduling'',''scheduling_manager'']))
             with check (public.has_any_role(array[''admin'',''scheduling'',''scheduling_manager'']))', t, t);
        created := created + 1;
      end if;
    end if;
  end loop;

  raise notice 'anon policies dropped: %, role policies created: %', dropped, created;
end $$;

-- Verify (expect ZERO rows — no anon policy left on any sched_* table):
--   SELECT tablename, policyname, roles::text
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename LIKE 'sched%'
--      AND ('anon' = ANY (roles) OR policyname LIKE 'Anon can %');
--
-- And expect every sched_* table to still have its role-gated policy:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND policyname LIKE 'scheduling_roles_all_%'
--    ORDER BY tablename;
