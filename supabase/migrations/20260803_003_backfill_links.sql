-- Backfill sched_appointment_links from existing appointments that have a
-- work_order_number, matching against the shared work_orders table.
-- Idempotent: ON CONFLICT DO NOTHING on the partial unique indexes.

do $$
declare
  v_backfilled int := 0;
  v_skipped_no_match int := 0;
  v_skipped_ambiguous int := 0;
  v_skipped_already_linked int := 0;
  v_total_candidates int := 0;
  rec record;
begin

  for rec in
    select
      a.id            as appointment_id,
      a.work_order_number,
      a.order_number
    from sched_appointments a
    where a.work_order_number is not null
      and a.work_order_number <> ''
      and a.status <> 'cancelled'
      -- skip appointments that already have an active link
      and not exists (
        select 1 from sched_appointment_links l
        where l.appointment_id = a.id
          and l.unlinked_at is null
      )
  loop
    v_total_candidates := v_total_candidates + 1;

    -- Count how many work_orders rows match this WO number
    declare
      v_wo_count int;
      v_wo_id    text;
    begin
      select count(*) into v_wo_count
        from work_orders wo
       where wo.work_order_number = rec.work_order_number;

      if v_wo_count = 0 then
        v_skipped_no_match := v_skipped_no_match + 1;
        continue;
      end if;

      if v_wo_count > 1 then
        v_skipped_ambiguous := v_skipped_ambiguous + 1;
        continue;
      end if;

      -- Exactly one match — grab the id
      select wo.id::text into v_wo_id
        from work_orders wo
       where wo.work_order_number = rec.work_order_number
       limit 1;

      -- Insert the link (ON CONFLICT DO NOTHING handles races and re-runs)
      insert into sched_appointment_links (
        appointment_id,
        source_system,
        external_key,
        work_order_number,
        order_number,
        match_method,
        linked_at
      ) values (
        rec.appointment_id,
        'rforce',
        v_wo_id,
        rec.work_order_number,
        rec.order_number,
        'wo_exact',
        now()
      )
      on conflict do nothing;

      if found then
        v_backfilled := v_backfilled + 1;
      else
        v_skipped_already_linked := v_skipped_already_linked + 1;
      end if;
    end;
  end loop;

  raise notice '── Backfill sched_appointment_links complete ──';
  raise notice 'Candidates evaluated  : %', v_total_candidates;
  raise notice 'Backfilled (inserted) : %', v_backfilled;
  raise notice 'Skipped (no match)    : %', v_skipped_no_match;
  raise notice 'Skipped (ambiguous)   : %', v_skipped_ambiguous;
  raise notice 'Skipped (already linked): %', v_skipped_already_linked;

end $$;
