-- Activity log: an event trail for changes that have no tile to hang an event on.
--
-- sched_appointment_events already records everything that happens to an
-- appointment, but it is keyed to a live row (ON DELETE CASCADE), so:
--   * availability rules (incl. the one-day Special Ops / Office Day tiles),
--     company-wide calendar blocks: logged nowhere (only created_by/updated_at)
--   * a hard-deleted tile: its whole history is deleted with it
--
-- This table is the append-only home for both. The app writes to it from the
-- store layer (availability + calendar-block upserts/deletes, deleteAppointment)
-- and the manager-only /activity page reads it alongside appointment events.
--
-- Read: admin + scheduling_manager only (the page is manager-gated; this makes
--       the gate real instead of cosmetic).
-- Write: any scheduling role (every scheduler's edits are what we are logging).
-- No update/delete policy: the trail is append-only.
--
-- Idempotent. Run in the Supabase SQL editor on the shared RbA project.

begin;

create table if not exists public.sched_activity_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('availability_rule', 'calendar_block', 'appointment')),
  entity_id uuid,
  action text not null check (action in ('created', 'updated', 'deleted')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name_snapshot text,
  summary text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_events_created
  on public.sched_activity_events (created_at desc);
create index if not exists idx_activity_events_entity
  on public.sched_activity_events (entity_type, entity_id);

-- Filtering the log by actor / newest-first reads these on the existing table.
create index if not exists idx_appt_events_actor_created
  on public.sched_appointment_events (actor_name_snapshot, created_at desc);

alter table public.sched_activity_events enable row level security;

drop policy if exists "managers_read_sched_activity_events" on public.sched_activity_events;
create policy "managers_read_sched_activity_events"
  on public.sched_activity_events for select
  using (has_any_role(array['admin', 'scheduling_manager']));

drop policy if exists "scheduling_roles_insert_sched_activity_events" on public.sched_activity_events;
create policy "scheduling_roles_insert_sched_activity_events"
  on public.sched_activity_events for insert
  with check (has_any_role(array['admin', 'scheduling', 'scheduling_manager']));

-- New tables after 2026-10-30 need their own grant (see 20260923_001).
-- No anon, no update, no delete: RLS above is the gate, this is the ceiling.
grant select, insert on public.sched_activity_events to authenticated, service_role;

commit;
