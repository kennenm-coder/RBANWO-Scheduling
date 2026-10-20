-- ============================================================
-- 2026-10-20 OUTAGE FIX: infinite recursion in sched_profiles RLS
--
-- Every RbA NWO app went down for roughly an hour. Supabase reported the
-- project as Unhealthy, flapping back to Healthy after a restart and then
-- failing again within minutes. The database itself was fine the whole time —
-- CPU 12%, RAM ~60%, 22/60 connections. The Supabase Watchdog stayed green,
-- because it probes auth health and auth never went down.
--
-- The cause was the "Admins can manage profiles" policy created in migration
-- 20260730_001_profiles_and_preferences.sql:
--
--   create policy "Admins can manage profiles"
--     on sched_profiles for all
--     using (exists (select 1 from sched_profiles p
--                    where p.id = auth.uid() and p.role in ('admin','manager')));
--
-- The policy guarding sched_profiles queries sched_profiles. To decide whether
-- you may read a row, Postgres must read a row, which requires deciding whether
-- you may read a row. Postgres detects the cycle and raises:
--
--   ERROR: infinite recursion detected in policy for relation "sched_profiles"
--
-- Because the policy is FOR ALL it fired on plain SELECTs too, so the
-- scheduling app could not load a single tile. The recursion burned enough CPU
-- to push the whole project into `canceling statement due to statement timeout`
-- — ~890 API-gateway errors and ~340 Postgres errors in 24h, across every app
-- sharing this database, not just scheduling.
--
-- Restarting the project appears to fix it: connections drop and the errors
-- stop. Then the apps reconnect and it starts over. Do not restart; fix the
-- policy.
--
-- THE FIX: move the role check into a SECURITY DEFINER function. A definer
-- function runs as its owner, and the owner bypasses RLS, so reading
-- sched_profiles inside it does not re-enter the policy and the cycle is
-- broken.
--
-- Note on existing helpers: is_allowlisted() and has_any_role(text[]) are both
-- SECURITY DEFINER and would not recurse, but they read `allowed_emails`, not
-- `sched_profiles.role`. Using them here would silently change who counts as an
-- admin, so this migration adds a helper that preserves the original rule
-- exactly.
--
-- Per 20261008_002, a SECURITY DEFINER function in `public` is exposed over
-- PostgREST and granted to PUBLIC by default, so EXECUTE is revoked from PUBLIC
-- and granted only to authenticated. It takes no arguments and returns only a
-- boolean about the caller, so it leaks nothing even if called directly.
--
-- Applied to production by hand via the dashboard SQL editor at
-- 2026-10-20 14:24:49 America/Chicago. This file exists so a rebuild or a
-- re-run of the migrations does not reintroduce the outage.
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

-- ── The non-recursive admin check ───────────────────────────────────────────
create or replace function public.sched_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.sched_profiles
    where id = auth.uid()
      and role = any (array['admin', 'manager'])
  );
$fn$;

revoke all on function public.sched_is_admin() from public;
revoke all on function public.sched_is_admin() from anon;
grant execute on function public.sched_is_admin() to authenticated;

comment on function public.sched_is_admin() is
  'True when the current user is an admin or manager in sched_profiles. SECURITY DEFINER so it bypasses RLS and can be called from sched_profiles policies without infinite recursion (2026-10-20 outage fix). EXECUTE revoked from PUBLIC/anon.';

-- ── Replace the recursive policy ────────────────────────────────────────────
drop policy if exists "Admins can manage profiles" on public.sched_profiles;

create policy "Admins can manage profiles"
  on public.sched_profiles
  for all
  to authenticated
  using (public.sched_is_admin())
  with check (public.sched_is_admin());

-- ── Reconcile read access with what production actually has ─────────────────
-- 20260730_001 also created:
--
--   create policy "Users can read all profiles"
--     on sched_profiles for select to authenticated using (true);
--
-- That policy is NOT in production — it was replaced in the dashboard during
-- the 2026-10-08 RLS hardening by an allowlist check, but the migration was
-- never updated. Since self-serve signup is live on this project,
-- `authenticated` means anyone on the internet who signed up, so a rebuild
-- running the old migration would hand every signup read access to every
-- employee profile. Converge the files onto the production state.
--
-- Depends on public.is_allowlisted(), defined for the shared project (see
-- Betterthengooglecal/supabase/migrations/019_lock_down_shared_tables.sql).
drop policy if exists "Users can read all profiles" on public.sched_profiles;
drop policy if exists allowlisted_read_sched_profiles on public.sched_profiles;

create policy allowlisted_read_sched_profiles
  on public.sched_profiles
  for select
  using (public.is_allowlisted());

-- Verify (expects exactly three policies, none of them self-referencing:
--   Admins can manage profiles        ALL     sched_is_admin()
--   Users can update own profile      UPDATE  (id = auth.uid())
--   allowlisted_read_sched_profiles   SELECT  is_allowlisted()
-- ):
--   SELECT policyname, cmd, qual
--     FROM pg_policies WHERE tablename = 'sched_profiles' ORDER BY 1;
--
-- And confirm a read completes rather than erroring:
--   BEGIN; SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM public.sched_profiles; ROLLBACK;
