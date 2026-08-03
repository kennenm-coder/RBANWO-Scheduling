-- Reconciliation results table and server-side comparison function.
-- Stores the computed sync status for each active appointment link.

-- ── Table ──

create table if not exists sched_reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references sched_appointment_links(id) on delete cascade,
  sync_status text not null,
  differences jsonb,
  app_date text,
  app_crew_id uuid,
  app_time_block text,
  rforce_date text,
  rforce_resource text,
  rforce_status text,
  evaluated_at timestamptz not null default now()
);

create unique index if not exists uq_reconciliation_link
  on sched_reconciliation_results (link_id);


-- ── Function: reconcile_linked_appointments() ──
-- For each active link, compare the app appointment against the work_orders
-- row (via external_key = work_orders.id) and upsert a reconciliation result.

create or replace function reconcile_linked_appointments()
returns table (
  links_evaluated int,
  in_sync int,
  mismatched int,
  source_missing int
)
language plpgsql
as $$
declare
  rec record;
  v_sync_status text;
  v_differences jsonb;
  v_app_date text;
  v_app_crew_id uuid;
  v_app_crew_name text;
  v_app_time_block text;
  v_rforce_date text;
  v_rforce_resource text;
  v_rforce_status text;
  v_date_match boolean;
  v_crew_match boolean;
  v_links_evaluated int := 0;
  v_in_sync int := 0;
  v_mismatched int := 0;
  v_source_missing int := 0;
begin

  for rec in
    select
      l.id            as link_id,
      l.external_key,
      l.appointment_id,
      -- App side
      a.scheduled_date,
      a.crew_id,
      a.time_block,
      a.status        as app_status,
      -- Crew name from sched_crews
      c.name          as crew_name,
      -- rForce side (work_orders)
      wo.id           as wo_id,
      wo.scheduled_start,
      wo.status       as wo_order_status,
      wo.appointment_status as wo_appt_status,
      coalesce(wo.tech_measure, wo.installer, wo.service_rep, wo.primary_resource) as wo_resource
    from sched_appointment_links l
    join sched_appointments a on a.id = l.appointment_id
    left join sched_crews c on c.id = a.crew_id
    left join work_orders wo on wo.id::text = l.external_key
    where l.unlinked_at is null
  loop
    v_links_evaluated := v_links_evaluated + 1;
    v_differences := '{}'::jsonb;

    -- Gather app-side values
    v_app_date       := rec.scheduled_date::text;
    v_app_crew_id    := rec.crew_id;
    v_app_crew_name  := rec.crew_name;
    v_app_time_block := rec.time_block;

    -- Check if rForce row exists
    if rec.wo_id is null then
      v_sync_status    := 'source_missing';
      v_rforce_date    := null;
      v_rforce_resource := null;
      v_rforce_status  := null;
      v_source_missing := v_source_missing + 1;

      insert into sched_reconciliation_results (
        link_id, sync_status, differences,
        app_date, app_crew_id, app_time_block,
        rforce_date, rforce_resource, rforce_status,
        evaluated_at
      ) values (
        rec.link_id, v_sync_status, v_differences,
        v_app_date, v_app_crew_id, v_app_time_block,
        v_rforce_date, v_rforce_resource, v_rforce_status,
        now()
      )
      on conflict (link_id) do update set
        sync_status    = excluded.sync_status,
        differences    = excluded.differences,
        app_date       = excluded.app_date,
        app_crew_id    = excluded.app_crew_id,
        app_time_block = excluded.app_time_block,
        rforce_date    = excluded.rforce_date,
        rforce_resource = excluded.rforce_resource,
        rforce_status  = excluded.rforce_status,
        evaluated_at   = excluded.evaluated_at;

      continue;
    end if;

    -- Gather rForce-side values
    v_rforce_date     := (rec.scheduled_start at time zone 'America/New_York')::date::text;
    v_rforce_resource := rec.wo_resource;
    v_rforce_status   := coalesce(rec.wo_appt_status, rec.wo_order_status);

    -- Check for rForce terminal statuses
    if lower(coalesce(v_rforce_status, '')) in ('cancelled', 'canceled') then
      v_sync_status := 'rforce_cancelled';
      v_differences := jsonb_build_object('status', jsonb_build_object(
        'app', rec.app_status,
        'rforce', v_rforce_status
      ));
      v_mismatched := v_mismatched + 1;

    elsif lower(coalesce(v_rforce_status, '')) in ('complete', 'completed') then
      v_sync_status := 'rforce_complete';
      v_differences := jsonb_build_object('status', jsonb_build_object(
        'app', rec.app_status,
        'rforce', v_rforce_status
      ));
      -- rforce_complete is informational, not necessarily a mismatch
      v_in_sync := v_in_sync + 1;

    else
      -- Compare date
      v_date_match := (v_app_date = v_rforce_date);
      if not v_date_match then
        v_differences := v_differences || jsonb_build_object('date', jsonb_build_object(
          'app', v_app_date,
          'rforce', v_rforce_date
        ));
      end if;

      -- Compare crew / resource
      -- Strategy: exact match on full name first, then case-insensitive
      -- first-name comparison as fallback
      v_crew_match := false;
      if v_rforce_resource is not null and v_app_crew_name is not null then
        -- 1. Check sched_resource_mappings for an exact mapping
        if exists (
          select 1 from sched_resource_mappings rm
          where rm.is_active = true
            and lower(rm.raw_name) = lower(v_rforce_resource)
            and rm.crew_id = v_app_crew_id
        ) then
          v_crew_match := true;
        -- 2. Exact full-name match (case-insensitive)
        elsif lower(trim(v_app_crew_name)) = lower(trim(v_rforce_resource)) then
          v_crew_match := true;
        -- 3. First-name fallback (case-insensitive)
        elsif lower(split_part(trim(v_app_crew_name), ' ', 1))
            = lower(split_part(trim(v_rforce_resource), ' ', 1))
          and length(split_part(trim(v_app_crew_name), ' ', 1)) > 1
        then
          v_crew_match := true;
        end if;
      elsif v_rforce_resource is null and v_app_crew_name is not null then
        -- rForce has no resource assigned — not a crew mismatch per se
        v_crew_match := true;
      elsif v_rforce_resource is null and v_app_crew_name is null then
        v_crew_match := true;
      end if;

      if not v_crew_match then
        v_differences := v_differences || jsonb_build_object('crew', jsonb_build_object(
          'app', coalesce(v_app_crew_name, '(none)'),
          'rforce', coalesce(v_rforce_resource, '(none)')
        ));
      end if;

      -- Determine sync_status
      if v_date_match and v_crew_match then
        v_sync_status := 'in_sync';
        v_in_sync := v_in_sync + 1;
      elsif not v_date_match and not v_crew_match then
        v_sync_status := 'multi_mismatch';
        v_mismatched := v_mismatched + 1;
      elsif not v_date_match then
        v_sync_status := 'date_mismatch';
        v_mismatched := v_mismatched + 1;
      else
        v_sync_status := 'crew_mismatch';
        v_mismatched := v_mismatched + 1;
      end if;
    end if;

    -- Clear differences if in sync (no stale data from previous runs)
    if v_sync_status = 'in_sync' then
      v_differences := null;
    end if;

    -- Upsert the result
    insert into sched_reconciliation_results (
      link_id, sync_status, differences,
      app_date, app_crew_id, app_time_block,
      rforce_date, rforce_resource, rforce_status,
      evaluated_at
    ) values (
      rec.link_id, v_sync_status, v_differences,
      v_app_date, v_app_crew_id, v_app_time_block,
      v_rforce_date, v_rforce_resource, v_rforce_status,
      now()
    )
    on conflict (link_id) do update set
      sync_status    = excluded.sync_status,
      differences    = excluded.differences,
      app_date       = excluded.app_date,
      app_crew_id    = excluded.app_crew_id,
      app_time_block = excluded.app_time_block,
      rforce_date    = excluded.rforce_date,
      rforce_resource = excluded.rforce_resource,
      rforce_status  = excluded.rforce_status,
      evaluated_at   = excluded.evaluated_at;

  end loop;

  -- Return summary
  return query select v_links_evaluated, v_in_sync, v_mismatched, v_source_missing;
end;
$$;
