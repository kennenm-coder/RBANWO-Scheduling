-- ============================================================
-- Fix resource-mapping auto-learning, broken since 20260803_002
--
-- upsertResourceMapping() in src/lib/store.ts has never once succeeded. It
-- called:
--
--   .from("sched_resource_mappings")
--   .upsert({ raw_name, crew_id, ... }, { onConflict: "raw_name" })
--
-- but the only unique index on that table is the one 20260803_002 created:
--
--   uq_resource_mapping_name on sched_resource_mappings (lower(raw_name))
--     where is_active = true
--
-- That index is on an EXPRESSION (lower(raw_name), not raw_name) and is
-- PARTIAL (where is_active = true). `ON CONFLICT (raw_name)` matches neither
-- property, so every call returned:
--
--   ERROR: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- learnResourceMapping() in src/lib/resource-learning.ts catches that and only
-- console.warn()s — deliberately, since learning must never block a scheduler
-- mid-approval. So it failed silently for two and a half months and the fuzzy
-- matcher never got any smarter. The migration that introduced the table says
-- it "replaces first-name guessing"; in practice it never recorded a mapping.
--
-- PostgREST cannot express an expression or partial conflict target, so no
-- amount of fiddling with the `onConflict` string will fix this from the
-- client. Hence an RPC that does the real thing.
--
-- Deliberately NOT changing the index to a plain `unique (raw_name)`: that
-- would drop the case-insensitivity (so "Smith" and "smith" would become two
-- mappings) and the partial predicate (so deactivated mappings would block
-- re-adding the same name). The index is right; the client call was wrong.
--
-- SECURITY INVOKER, not DEFINER. The caller's RLS still applies, so the
-- existing gate is preserved exactly:
--
--   scheduling_roles_all_sched_resource_mappings — FOR ALL
--     using/with check has_any_role(ARRAY['admin','scheduling','scheduling_manager'])
--
-- A definer function here would silently hand write access to every
-- authenticated account, which on this project means anyone who signed up.
-- Per 20261008_002, EXECUTE is still revoked from PUBLIC/anon rather than
-- relying on RLS alone.
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

-- Guard the assumption this function is built on: if the index is ever
-- redefined, the ON CONFLICT below stops inferring it and we are back to the
-- original silent failure. Fail at migration time instead.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_resource_mapping_name'
      and indexdef ilike '%lower(raw_name)%'
      and indexdef ilike '%is_active = true%'
  ) then
    raise exception
      'uq_resource_mapping_name is missing or no longer (lower(raw_name)) WHERE is_active = true; sched_upsert_resource_mapping would not infer it.';
  end if;
end $$;

create or replace function public.sched_upsert_resource_mapping(
  p_raw_name text,
  p_crew_id  uuid
)
returns public.sched_resource_mappings
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_row public.sched_resource_mappings;
begin
  if p_raw_name is null or length(btrim(p_raw_name)) = 0 then
    raise exception 'sched_upsert_resource_mapping: p_raw_name is required';
  end if;
  if p_crew_id is null then
    raise exception 'sched_upsert_resource_mapping: p_crew_id is required';
  end if;

  insert into public.sched_resource_mappings (raw_name, crew_id, is_active, updated_at)
  values (p_raw_name, p_crew_id, true, now())
  on conflict (lower(raw_name)) where is_active = true
  do update set crew_id    = excluded.crew_id,
                updated_at = now()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.sched_upsert_resource_mapping(text, uuid) from public;
revoke all on function public.sched_upsert_resource_mapping(text, uuid) from anon;
grant execute on function public.sched_upsert_resource_mapping(text, uuid) to authenticated;

comment on function public.sched_upsert_resource_mapping(text, uuid) is
  'Upsert an rForce resource-name to crew mapping, matching the partial expression index uq_resource_mapping_name (lower(raw_name)) WHERE is_active = true, which the PostgREST onConflict option cannot target. SECURITY INVOKER, so the scheduling_roles RLS policy still applies. Replaces the broken upsert with onConflict raw_name (2026-10-20).';

-- Verify:
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'sched_upsert_resource_mapping';   -- authenticated only
--
--   BEGIN;
--     SELECT * FROM public.sched_upsert_resource_mapping('__verify__', (SELECT id FROM sched_crews LIMIT 1));
--     SELECT * FROM public.sched_upsert_resource_mapping('__VERIFY__', (SELECT id FROM sched_crews LIMIT 1));
--     -- expect ONE row, same id both times (case-insensitive match)
--     SELECT count(*) FROM sched_resource_mappings WHERE lower(raw_name) = '__verify__';
--   ROLLBACK;
