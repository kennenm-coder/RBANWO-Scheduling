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

### store.ts (7 instances)

| Line | Function | What's silenced | Risk |
|------|----------|----------------|------|
| ~569-604 | `upsertAvailabilityRule` | `repeat_interval` column missing | Rule saved without interval |
| ~651 | `fetchDismissals` | Table may not exist | No dismissals loaded |
| ~762-768 | `approveRForceOrder` | Sync field update fails | Appointment created without sync tracking |
| ~773 | `approveRForceOrder` | Link creation fails | **Appointment exists without link, `link!` assertion lies** |
| ~787 | `approveRForceOrder` | Audit event fails | No record of approval |
| ~800-805 | `fetchFlagResolutions` | Table may not exist | No resolutions loaded |
| ~842-847 | `fetchMatchRejections` | Table may not exist | No rejection memory |

### merge.ts (3 instances)

| Line | Function | What's silenced | Risk |
|------|----------|----------------|------|
| ~127 | `mergeRForceIntoAppointment` | Sync field update | Merge data applied but sync state wrong |
| ~141 | `mergeRForceIntoAppointment` | Link creation | **Merge applied but no link created** |
| ~165 | `mergeRForceIntoAppointment` | Audit event | No record of merge |

### sync-transitions.ts (3 instances)

| Line | Function | What's silenced | Risk |
|------|----------|----------------|------|
| ~62 | `onSchedulerEditedLinkedAppointment` | Sync state + event | Sync tracking silently broken |
| ~87 | `onAppointmentLinked` | Sync state + event | Sync tracking silently broken |
| ~112 | `onAppointmentUnlinked` | Sync state + event | Sync tracking silently broken |

### geocode.ts (4 instances)

Schema-column fallbacks for `precision`, `manual_override`, `provider` columns.

### DataProvider.tsx (3 instances)

| Line | Context | What's silenced |
|------|---------|----------------|
| ~156 | `loadData` | `fetchDismissals()` failure → empty array |
| ~157 | `loadData` | `fetchFlagResolutions()` failure → empty array |
| ~158 | `loadData` | `fetchMatchRejections()` failure → empty array |

## Category 3: Fire-and-forget mutations

| Location | Mutation | Risk |
|----------|---------|------|
| ~~`DataProvider.tsx:180`~~ | ~~Auto-cancel appointments~~ | **REMOVED in this commit** |
| `store.ts:507` | `createAppointmentEvent` — no error check on insert | Audit events silently dropped |
| `store.ts:204` | `updateSyncFields` — no version check | Can overwrite concurrent sync state changes |

## Category 4: Non-null assertions on potentially null values

| Location | Code | Risk |
|----------|------|------|
| `store.ts:791` | `link: link!` | Link may be null after silent catch; callers assume non-null |

## Category 5: Schema-drift defensive patterns

| Location | Pattern | Column/Table |
|----------|---------|-------------|
| `store.ts:112` | Destructures out fields "that may not exist as DB columns yet" | `manual_override`, `override_source`, `time_block_end`, `merge_source_wo`, `origin`, `sync_state`, `original_entry_snapshot`, `last_reconciled_import_id` |
| `store.ts:569` | Try without `repeat_interval`, retry with it, then separate update | `sched_availability_rules.repeat_interval` |
| `geocode.ts:20-37` | Try with `precision`/`manual_override`, fallback to basic select | `sched_geocode_cache.precision`, `.manual_override` |
| `geocode.ts:60-82` | Try upsert with extended columns, fallback to basic | Same |
| `geocode.ts:186-208` | Try manual correction with extended columns, fallback | Same |
| `geocode.ts:225-237` | Try bulk lookup with extended columns, fallback | Same |

## Resolution Plan

As each phase stabilizes its schema domain, the corresponding silent failures
should be replaced with proper error surfacing:

| Phase | Removes silent failures in |
|-------|---------------------------|
| Phase 1 (schema) | All "column may not exist" patterns in store.ts and geocode.ts |
| Phase 2 (scheduling engine) | Sync field + audit event catches in store.ts and sync-transitions.ts |
| Phase 6 (import boundary) | `fetchDismissals`, `fetchFlagResolutions`, `fetchMatchRejections` table-missing catches |
| Phase 8 (linking/merging) | Silent link+audit catches in merge.ts and store.ts `approveRForceOrder` |
| Phase 13 (auth) | `if (!sb) return []` patterns (Supabase client requires auth) |
| Phase 14 (observability) | All remaining: loading state errors, connection indicators, UI error states |
