# rForce Reconciliation — Practical Implementation Plan

Last updated: August 3, 2026

## Core principle

The scheduling app owns the schedule. rForce is a read-only observation of what Salesforce thinks.
An import never silently moves, edits, or deletes a scheduler's appointment.

---

## What's broken today (and what we're fixing)

### 1. Linking is a loose string match
`linkAppointmentToRForce()` in `store.ts:192` just writes a `work_order_number` onto the appointment row. Nothing prevents two appointments from claiming the same WO, and there's no link history or approval trail.

### 2. Reconciliation is client-side and shallow
`reconcile.ts` loads every rForce order into the browser, matches by WO number, and only compares date (`scheduled_start.split("T")[0]`). It misses time, crew, type, and duration differences. It also depends on the browser's loaded appointment window, so out-of-range linked appointments look like rForce-only.

### 3. The app reads from a table it doesn't own
`fetchRForceOrders()` reads from the shared `work_orders` table (Duck Force), not the `sched_rforce_orders` table defined in this app's schema. Column names are mapped inline with `(row as any)`. The `sched_rforce_orders` table is dead code.

### 4. Crew matching uses first names
`matchCrewByName()` in `calendar-utils.ts` and `checkDiscrepancy()` compare `crewName.split(" ")[0]`. Two "Alex" or "Randy" entries = wrong assignments.

### 5. Mutations and audit events are separate requests
`createAppointmentEvent()` is a separate Supabase call from `updateAppointment()`. If one succeeds and the other fails, you get appointments without history or orphaned events.

### 6. Flags are ephemeral
`detectFlags()` in `flags.ts` computes flags fresh on every render from in-memory data. The `sched_flags` table exists but the Issues UI ignores it. A flag can't be acknowledged, snoozed, or tracked over time.

### 7. `manual_override` is inconsistent
Only set on some drag paths. A modal edit creating the same date/crew mismatch won't set it, so the same situation shows as a "discrepancy" via one UI path and "manual override" via another.

---

## Phase 1 — Proper link table and crew resource mappings ✅ IMPLEMENTED

**Goal:** Two appointments can never claim the same rForce record. Crew matching stops guessing.

### Database changes

**`sched_appointment_links`** — replaces the loose WO-number-on-appointment approach:
```sql
create table sched_appointment_links (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references sched_appointments(id),
  source_system text not null default 'rforce',
  external_key text not null,           -- work_orders.id from the source
  work_order_number text,
  order_number text,
  match_method text not null,           -- 'wo_exact', 'manual', 'auto'
  linked_by uuid,
  linked_at timestamptz default now(),
  unlinked_by uuid,
  unlinked_at timestamptz,
  unlink_reason text,
  created_at timestamptz default now()
);

-- Only one active link per appointment
create unique index uq_active_link_appointment
  on sched_appointment_links (appointment_id)
  where unlinked_at is null;

-- Only one active link per rForce record
create unique index uq_active_link_external
  on sched_appointment_links (source_system, external_key)
  where unlinked_at is null;
```

**`sched_resource_mappings`** — replaces first-name guessing:
```sql
create table sched_resource_mappings (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null,               -- exactly as it appears in rForce
  crew_id uuid not null references sched_crews(id),
  is_active boolean default true,
  approved_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (raw_name)
);
```

### Code changes

- **`store.ts`**: Add `linkAppointment()` that inserts into `sched_appointment_links` instead of writing WO number onto the appointment. Add `unlinkAppointment()` with reason. Add `fetchActiveLinks()`.
- **`store.ts`**: Add `fetchResourceMappings()`, `upsertResourceMapping()`.
- **`calendar-utils.ts`**: Replace `matchCrewByName()` first-name logic with a lookup against `sched_resource_mappings`. Unknown names go to an "unmapped" bucket instead of guessing.
- **`LinkModal.tsx`**: Update to write to the link table. Show a warning if the external key is already linked elsewhere.
- **`types.ts`**: Add `AppointmentLink` and `ResourceMapping` interfaces.

### Migration for existing data

Backfill `sched_appointment_links` from existing appointments that have `work_order_number` set, matching against `work_orders.id`. Flag any WO numbers that match multiple appointments or multiple `work_orders` rows.

### What this doesn't do yet
- No approval workflow for inferred matches (that's Phase 3)
- No ghost overlay (Phase 4)
- Still reads from `work_orders` directly (fixed in Phase 2)

---

## Phase 2 — Server-side reconciliation and rForce snapshot ⚡ PARTIALLY IMPLEMENTED

**Goal:** Reconciliation compares all fields, runs server-side, and doesn't depend on what the browser loaded.

**Status:** Reconciliation results table and `reconcile_linked_appointments()` Postgres function are built. Client-side `reconcile.ts` and `flags.ts` enhanced to compare date, time, crew, and type. Snapshot table deferred — app still reads `work_orders` directly (which works fine since Power Automate keeps it current).

### Database changes

**`sched_rforce_snapshot`** — app-owned copy of the rForce state:
```sql
create table sched_rforce_snapshot (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,       -- work_orders.id
  work_order_number text not null,
  order_number text,
  customer_name text,
  account_name text,
  address text,
  work_order_type text,
  order_status text,
  wo_status text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  scheduled_date date generated always as (
    (scheduled_start at time zone 'America/New_York')::date
  ) stored,
  primary_resource text,
  tech_measure_name text,
  installer text,
  service_rep text,
  product_count int,
  windows int,
  patio_doors int,
  doors int,
  order_alerts text,
  description text,
  contact_name text,
  email text,
  phones jsonb,
  row_hash text,                        -- detect actual changes
  snapshot_taken_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

**`sched_reconciliation_results`** — computed comparison for each linked pair:
```sql
create table sched_reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references sched_appointment_links(id) unique,
  sync_status text not null,            -- 'in_sync', 'date_mismatch', 'crew_mismatch',
                                        -- 'multi_mismatch', 'rforce_cancelled', 'rforce_complete',
                                        -- 'source_missing'
  differences jsonb,                    -- {"date": {"app": "2026-08-14", "rforce": "2026-08-12"}, ...}
  evaluated_at timestamptz default now()
);
```

### Snapshot sync process

A Supabase database function (or Edge Function) that:
1. Reads current `work_orders` rows
2. Upserts into `sched_rforce_snapshot` using `source_id`
3. Computes `row_hash` to detect real changes
4. Marks which rows changed since last sync

This runs on a schedule (or triggered by the existing Power Automate flow). The app reads `sched_rforce_snapshot` instead of `work_orders` directly.

### Server reconciliation function

A Postgres function `reconcile_all()` or Edge Function that:
1. Joins `sched_appointment_links` to `sched_appointments` and `sched_rforce_snapshot`
2. Compares: date, time block, mapped crew, type, status
3. Writes structured differences to `sched_reconciliation_results`
4. Runs after every snapshot sync and every appointment mutation

### Code changes

- **`store.ts`**: `fetchRForceOrders()` reads from `sched_rforce_snapshot` instead of `work_orders`. Remove the column remapping hack.
- **`reconcile.ts`**: Becomes a thin client that reads `sched_reconciliation_results` from the server. Keep a local fallback for the transition period.
- **`DataProvider.tsx`**: Fetch reconciliation results alongside appointments. Subscribe to realtime changes on the results table.
- **`UnscheduledQueue.tsx`**: Read server results instead of computing them client-side.

### Scheduler notes migration

Move scheduler notes to an app-owned column or table. Currently `updateSchedulerNotes()` writes to `work_orders.scheduler_notes` — if the upstream table is refreshed, notes could be lost.

---

## Phase 3 — Atomic mutations and persistent flags 🔜 FUTURE

**Goal:** Every mutation + its audit event is one transaction. Flags persist and can be tracked.

### Transactional RPCs

Create Supabase database functions for the critical operations:

- **`rpc_create_appointment`**: Insert appointment + audit event + allocations in one transaction. Return the new appointment.
- **`rpc_update_appointment`**: Update + audit event + reconciliation recompute. Uses `expected_version` for optimistic concurrency.
- **`rpc_cancel_appointment`**: Cancel + audit event + release allocations + reconcile. Preserves the rForce link.
- **`rpc_link_appointment`**: Create link + audit event + reconcile. Enforced by the unique indexes.

### Persistent flags

Switch the Issues UI from `detectFlags()` to reading/writing `sched_flags`:

- Auto-detect flags server-side during reconciliation (date mismatch, crew mismatch, unmapped resource, etc.)
- Deduplicate by `(appointment_id, code)` or `(external_key, code)`
- Support acknowledge/snooze/resolve lifecycle
- Auto-resolve when a reconciliation run proves the condition cleared
- Keep `detectFlags()` for PTO conflicts and double-booking (these are fast and local)

### `manual_override` deprecation

Stop relying on `manual_override` as a flag. Instead: if the app appointment differs from the rForce snapshot, it's a mismatch — period. The scheduler sees this in the comparison and can acknowledge it. The mismatch is the truth; the override was just a workaround for not having proper reconciliation.

---

## Phase 4 — Ghost overlay ✅ IMPLEMENTED

**Goal:** Schedulers can see where rForce thinks jobs are, side-by-side with the app schedule.

### Calendar toggle

Add a `Show rForce` toggle in `CalendarHeader.tsx`, persisted in user preferences.

### Rendering rules

- **Solid tile** = app appointment (the real schedule)
- **Dashed/translucent tile** = rForce observation (where Salesforce has it)
- **In-sync pair at same location**: subtle rForce outline/badge on the app tile, no duplicate
- **Mismatch at different locations**: solid app tile stays, ghost appears at rForce location
- **Unlinked rForce**: ghost with a "?" badge, clickable to open match/link flow
- **Unmapped resource**: appears in an "Unplaced" tray instead of a guessed crew lane

### Ghost restrictions

Ghosts cannot be:
- Dragged or edited
- Counted in job totals or capacity
- Considered for double-booking checks
- Treated as real appointments by any operational logic

### Comparison drawer

Clicking a ghost (or the mismatch badge on an app tile) opens a side panel showing:
- App values vs. rForce values for date, time, crew, type, status
- Which values the scheduler should enter into rForce
- Actions: Link, Acknowledge, Open in rForce

---

## Phase 5 — Match suggestions (if needed) 🔜 FUTURE

**Goal:** When a new rForce record appears with no exact WO match, suggest possible app appointments.

This phase is conditional — it only matters if schedulers regularly create appointments before rForce records exist (and need to pair them later). If most linking happens via WO number, this can stay manual.

### If built:

- Score candidates by: matching account name, address, date, type, crew
- Require at least two matching fields to suggest
- Never auto-link an inferred match — always require scheduler approval
- Remember rejections so the same bad suggestion doesn't come back daily

---

## Files affected (all phases)

| File | Changes |
|---|---|
| `src/lib/types.ts` | Add `AppointmentLink`, `ResourceMapping`, `RForceSnapshot`, `ReconciliationResult` (server version) |
| `src/lib/store.ts` | Link CRUD, snapshot reads, RPC wrappers, remove `work_orders` direct reads |
| `src/lib/reconcile.ts` | Becomes server-result reader; keep local comparison as utility |
| `src/lib/calendar-utils.ts` | Replace `matchCrewByName()` with mapping lookup; add ghost item generation |
| `src/lib/flags.ts` | Keep for local checks; add server flag reader for reconciliation flags |
| `src/components/LinkModal.tsx` | Use link table; show conflicts |
| `src/components/DataProvider.tsx` | Add links, mappings, reconciliation results, rForce snapshot to context |
| `src/components/CalendarHeader.tsx` | Add rForce toggle |
| `src/components/CrewLaneDayView.tsx` | Render ghost tiles when toggle is on |
| `src/components/CrewLaneWeekView.tsx` | Same |
| `src/components/AppointmentSheet.tsx` | Show link status and comparison |
| `src/components/RForceDetailSheet.tsx` | Show link status; link actions |
| `src/components/UnscheduledQueue.tsx` | Read server reconciliation results |
| `src/components/IssueCenter.tsx` | Read persistent `sched_flags` |
| `supabase/migrations/` | New migrations for link table, snapshot, results, mappings, RPCs |

---

## What we're NOT building

- Full import pipeline with run lifecycle, staging, quarantine (the existing Power Automate / `work_orders` flow works fine as a source — we just snapshot from it)
- Automatic appointment creation from rForce (too risky without months of data to validate against)
- Complex status state machines (active/cancelled/complete cross-product) — we handle the common cases and flag the rest
- Enterprise matching engine with scoring thresholds and calibration
- Admin reconciliation dashboard with import metrics (add later if needed)

The Codex plan was designed for a system that doesn't trust its data source and needs to handle every edge case at the database level. This plan trusts that Power Automate keeps `work_orders` reasonably current and focuses on what schedulers actually need: knowing where rForce disagrees and having a clean way to link records.
