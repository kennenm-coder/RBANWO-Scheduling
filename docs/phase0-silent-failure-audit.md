# Phase 0 — Silent Failure Audit

> Every code path that swallows errors, returns empty data on failure, or fires
> mutations without checking results. These must be progressively replaced as
> each domain's schema stabilizes (per guardrail #12).

## Category 1: "No database" silent returns (`if (!sb) return []`)

**45 instances in `src/lib/store.ts`** — every fetch and mutation function silently
returns empty data or null when the Supabase client is unavailable. The UI renders
as if data simply doesn't exist.

**4 instances in `src/lib/auth.ts`** — auth functions return null sessions/users.

**4 instances in `src/lib/geocode.ts`** — geocode functions return null/empty.

**2 instances in `src/lib/preferences.ts`** — preference functions return defaults.

**Impact:** If Supabase fails to initialize, the entire app appears to load
successfully with no data and no error. The "connected" status indicator could
show false.

**Resolution timeline:** Phase 14 (Error handling & observability).

## Category 2: Silent catch blocks (errors swallowed)

### store.ts — ~~7 instances~~ → 0 remaining

| Line | Function | What's silenced | Status |
|------|----------|----------------|--------|
| ~~~569-604~~ | ~~`upsertAvailabilityRule`~~ | ~~`repeat_interval` column missing~~ | ✅ Removed (Phase 1 — schema guarantee) |
| ~~~651~~ | ~~`fetchDismissals`~~ | ~~Table may not exist~~ | ✅ Removed (Phase 2 — schema guarantee) |
| ~~~762-768~~ | ~~`approveRForceOrder`~~ | ~~Sync field update fails~~ | ✅ Removed (Phase 1 — sync fields in INSERT) |
| ~~~773~~ | ~~`approveRForceOrder`~~ | ~~Link creation fails~~ | ✅ Fixed (Phase 2 — console.warn, honest null return) |
| ~~~787~~ | ~~`approveRForceOrder`~~ | ~~Audit event fails~~ | ✅ Fixed (Phase 2 — createAppointmentEvent now warns) |
| ~~~800-805~~ | ~~`fetchFlagResolutions`~~ | ~~Table may not exist~~ | ✅ Removed (Phase 1) |
| ~~~842-847~~ | ~~`fetchMatchRejections`~~ | ~~Table may not exist~~ | ✅ Removed (Phase 2 — schema guarantee) |

### merge.ts — ~~3 instances~~ → 2 remaining (non-blocking, warned)

| Line | Function | What's silenced | Status |
|------|----------|----------------|--------|
| ~127 | `mergeRForceIntoAppointment` | Sync field update | ✅ Now console.warns (Phase 2) |
| ~141 | `mergeRForceIntoAppointment` | Link creation | ✅ Now console.warns (Phase 2) |
| ~~~165~~ | ~~`mergeRForceIntoAppointment`~~ | ~~Audit event~~ | ✅ Fixed (Phase 2 — createAppointmentEvent now warns) |

### sync-transitions.ts — ~~3 instances~~ → 3 remaining (non-blocking, warned)

| Line | Function | What's silenced | Status |
|------|----------|----------------|--------|
| ~62 | `onSchedulerEditedLinkedAppointment` | Sync state + event | ✅ Now console.warns (Phase 2) |
| ~87 | `onAppointmentLinked` | Sync state + event | ✅ Now console.warns (Phase 2) |
| ~112 | `onAppointmentUnlinked` | Sync state + event | ✅ Now console.warns (Phase 2) |

### geocode.ts — ~~4 instances~~ → 0 remaining

~~Schema-column fallbacks for `precision`, `manual_override`, `provider` columns.~~ ✅ All removed (Phase 1).

### DataProvider.tsx — ~~3 instances~~ → 0 remaining

| Line | Context | Status |
|------|---------|--------|
| ~~~156~~ | ~~`fetchDismissals().catch(() => [])`~~ | ✅ Removed (Phase 2) |
| ~~~157~~ | ~~`fetchFlagResolutions().catch(() => [])`~~ | ✅ Removed (Phase 2) |
| ~~~158~~ | ~~`fetchMatchRejections().catch(() => [])`~~ | ✅ Removed (Phase 2) |

## Category 3: Fire-and-forget mutations

| Location | Mutation | Status |
|----------|---------|--------|
| ~~`DataProvider.tsx:180`~~ | ~~Auto-cancel appointments~~ | ✅ **REMOVED (Phase 0)** |
| ~~`store.ts:507`~~ | ~~`createAppointmentEvent` — no error check~~ | ✅ **Fixed (Phase 2) — now checks error and console.warns** |
| `store.ts:204` | `updateSyncFields` — no version check | Remaining — Phase 10 (server reconciliation) |

## Category 4: Non-null assertions on potentially null values

| Location | Code | Status |
|----------|------|--------|
| ~~`store.ts:791`~~ | ~~`link: link!`~~ | ✅ **Fixed (Phase 2) — return type now `link: AppointmentLink \| null`** |

## Category 5: Schema-drift defensive patterns — ✅ ALL RESOLVED

| Location | Status |
|----------|--------|
| ~~`store.ts:112`~~ | ✅ Fixed (Phase 2) — only sync-model fields stripped (by design), `manual_override`/`override_source`/`time_block_end`/`merge_source_wo` now pass through |
| ~~`store.ts:569`~~ | ✅ Removed (Phase 1) |
| ~~`geocode.ts:20-37`~~ | ✅ Removed (Phase 1) |
| ~~`geocode.ts:60-82`~~ | ✅ Removed (Phase 1) |
| ~~`geocode.ts:186-208`~~ | ✅ Removed (Phase 1) |
| ~~`geocode.ts:225-237`~~ | ✅ Removed (Phase 1) |

## Resolution Progress

| Phase | Status | What it resolved |
|-------|--------|-----------------|
| Phase 0 (stabilization) | ✅ Done | Auto-cancel removed |
| Phase 1 (schema) | ✅ Done | All "column may not exist" patterns in store.ts and geocode.ts |
| Phase 2 (scheduling engine) | ✅ Done | Sync/audit catches → console.warn; table-may-not-exist catches removed; link! lie fixed; field stripping corrected |
| Phase 13 (auth) | Pending | `if (!sb) return []` patterns (Supabase client requires auth) |
| Phase 14 (observability) | Pending | Remaining: loading state errors, connection indicators, UI error states |
