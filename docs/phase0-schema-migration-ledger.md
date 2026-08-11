# Phase 0 — Schema & Migration Ledger

> Generated 2026-08-11. Re-verify counts before any data migration.

## Migration Inventory

### Legacy Root-Level Migrations (manual SQL Editor)

| File | Status | Tables/Columns Affected | Destructive? | Notes |
|------|--------|------------------------|--------------|-------|
| `supabase-schema.sql` | Applied | Creates `sched_crews`, `sched_appointments`, `sched_csv_imports`, `sched_rforce_orders`, `sched_settings` | No | Seeds crew data |
| `supabase-rls.sql` | Applied | RLS on all 5 original tables | No | **Wide-open: `FOR ALL USING (true)` with no role restriction — allows anon** |
| `supabase-migration-001.sql` | Applied | Renames `sched_rforce_orders` columns, adds description/product fields, expands `appointment_type` CHECK | Yes (DROP CONSTRAINT) | Adds `lswp`, `hoa`, `paint_stain`, `job_site_visit`, `collections` types |
| `supabase-migration-002-geocache.sql` | Applied | Creates `sched_geocode_cache` | No | |
| `supabase-migration-003-crew-aliases.sql` | Applied | Adds `aliases TEXT[]` to `sched_crews` | No | |
| `supabase-migration-004-misc-crew-type.sql` | Applied | Expands `crew_type` CHECK with `'misc'` | Yes (DROP CONSTRAINT) | |
| `supabase-migration-005-management-seconds.sql` | Applied | Expands `crew_type` CHECK with `'second'`, `'management'`; adds `manages`, `primary_crew_id`, `additional_types` | Yes (DROP CONSTRAINT) | |

### Formal Timestamped Migrations (`supabase/migrations/`)

| File | Status | Tables/Columns Affected | Destructive? | Notes |
|------|--------|------------------------|--------------|-------|
| `20260730_001_profiles_and_preferences.sql` | Applied | Creates `sched_profiles`, `sched_user_preferences` | No | RLS: authenticated only |
| `20260730_002_appointment_audit.sql` | Applied | Adds audit columns to `sched_appointments`; creates `sched_appointment_events` | No | Adds `created_by`, `updated_by`, `cancelled_by`, `cancelled_at`, `cancellation_reason`, `last_rescheduled_at` |
| `20260730_003_appointment_resources.sql` | Applied | Creates `sched_appointment_resources`; backfills from crew columns | No | **References `tertiary_crew_id` which has no CREATE/ALTER** |
| `20260730_004_availability_rules.sql` | Applied | Creates `sched_availability_rules`, `sched_availability_exceptions` | No | RLS: authenticated only |
| `20260730_005_flags.sql` | Applied | Creates `sched_flags` | No | **Table is unused — app uses client-side detection** |
| `20260730_006_geocache_improvements.sql` | **NO-OP** | Targets `sched_geocache` (wrong name) | No | **Bug: actual table is `sched_geocode_cache`; IF EXISTS makes it a no-op** |
| `20260731_001_manual_overrides.sql` | Applied | Adds `manual_override`, `override_source`, `time_block_end` to `sched_appointments` | Yes (DROP CONSTRAINT) | Expands event action CHECK |
| `20260731_005_availability_repeat_interval.sql` | Applied | Adds `repeat_interval` to `sched_availability_rules` | No | |
| `20260803_001_appointment_links.sql` | Applied | Creates `sched_appointment_links` | No | **Created without RLS** (fixed later in 003) |
| `20260803_002_resource_mappings.sql` | Applied | Creates `sched_resource_mappings` | No | **Created without RLS** (fixed later in 003) |
| `20260803_003_backfill_links.sql` | Applied | Data migration: backfills links from `work_orders` | No | References shared `work_orders` table |
| `20260803_004_reconciliation_results.sql` | Applied | Creates `sched_reconciliation_results`; creates `reconcile_linked_appointments()` | No | **Created without RLS** (fixed later); **table unused by app code** |
| `20260804_001_rforce_dismissals.sql` | Applied | Creates `sched_rforce_dismissals` | No | **Created without RLS** (fixed later in 003) |
| `20260804_002_flag_resolutions.sql` | Applied | Creates `sched_flag_resolutions` | No | **Created without RLS** (fixed later in 003) |
| `20260805_001_unschedule_and_merge.sql` | Applied | Expands `status` CHECK with `'unscheduled'`; drops NOT NULL on crew_id/scheduled_date/start_time/end_time; adds `merge_source_wo` | Yes (DROP CONSTRAINT, DROP NOT NULL, DROP INDEX) | Re-creates double-book index with updated WHERE |
| `20260806_001_geocache_precision.sql` | Applied | Adds `precision`, `provider`, `manual_override`, `updated_at` to `sched_geocode_cache` | No | Correct table name |
| `20260806_002_appointment_sync_model.sql` | **Verify** | Adds `origin`, `sync_state`, `original_entry_snapshot`, `last_reconciled_import_id` to `sched_appointments` | Yes (DROP CONSTRAINT on events) | **Core sync model — code falls back if columns missing** |
| `20260806_003_rls_lockdown.sql` | **Verify** | Enables RLS on 5 tables that had none | No | `sched_appointment_links`, `sched_resource_mappings`, `sched_rforce_dismissals`, `sched_flag_resolutions`, `sched_reconciliation_results` |
| `20260806_004_atomic_approve_rpc.sql` | **Verify** | Creates `approve_rforce_order()` function | No | **RPC exists but app bypasses it** (store.ts line 722) |
| `20260806_005_import_tracking.sql` | **INCORRECT** | Alters `csv_imports` (NOT `sched_csv_imports`); creates `sched_import_snapshots`, `sched_match_rejections` | No | **Bug: references `csv_imports` instead of `sched_csv_imports`; FK also targets wrong table** |
| `20260806_001_fix_availability_rules.sql` | **Verify** | Re-adds `repeat_interval`; adds anon RLS to availability tables | No | **⚠ Naming collision with `20260806_001_geocache_precision.sql`** |
| `20260806_002_anon_rls_policies.sql` | **Verify** | Adds anon RLS to `sched_appointment_events`, `sched_appointment_links`, `sched_flag_resolutions` | No | **Re-opens anon access on tables the lockdown secured** |

## Known Schema Issues

### 1. `csv_imports` vs `sched_csv_imports` (Migration 005)
Migration `20260806_005_import_tracking.sql` references `csv_imports` (without `sched_` prefix) for both ALTER TABLE and FK constraints. The original schema creates `sched_csv_imports`. Either a shared `csv_imports` table exists from Duck Force, or this migration will fail against a clean schema.

**Decision needed:** Rename to `sched_csv_imports` or confirm `csv_imports` is the correct shared table.

### 2. Phantom column: `tertiary_crew_id`
Referenced in TypeScript `Appointment` type, backfill migration (20260730_003), and the atomic approve RPC (20260806_004). **No CREATE TABLE or ALTER TABLE ever defines it.** Must have been added manually to production.

**Action:** Confirm it exists in production; add a migration to create it properly.

### 3. Migration naming collision
Two files share prefix `20260806_001_`:
- `20260806_001_geocache_precision.sql`
- `20260806_001_fix_availability_rules.sql`

**Action:** Rename one with the correct sequence number.

### 4. No-op migration (006)
`20260730_006_geocache_improvements.sql` targets `sched_geocache` but the actual table is `sched_geocode_cache`. The `IF EXISTS` check makes it silently do nothing.

**Action:** Mark as superseded by `20260806_001_geocache_precision.sql`.

### 5. Sync model columns may not be applied
Code in `store.ts` explicitly guards against sync columns not existing (`try/catch` with comments like "Phase 2a migration not applied yet"). Need to verify these columns exist in production.

## Ghost Tables (Created but Unused by App Code)

| Table | Created In | Why Unused | Recommendation |
|-------|-----------|------------|----------------|
| `sched_rforce_orders` | `supabase-schema.sql` | App reads from shared `work_orders` table instead | Wire into Domain B import pipeline or drop |
| `sched_flags` | `20260730_005_flags.sql` | App uses client-side `detectFlags()` | Wire into server-side flag storage (Phase 11) or drop |
| `sched_appointment_resources` | `20260730_003` | App uses `crew_id`/`secondary_crew_id`/`tertiary_crew_id` columns directly | Wire into multi-resource model (Phase 3) or drop |
| `sched_reconciliation_results` | `20260803_004` | SQL function exists but no TS code reads/writes | Wire into server-side reconciliation (Phase 10) or drop |
| `sched_import_snapshots` | `20260806_005` | Types exist but no TS code reads/writes | Wire into import tracking (Phase 6) or drop |
| `sched_settings` | `supabase-schema.sql` | Never referenced in any TypeScript file | Wire in for app settings or drop |
| `sched_user_preferences` | `20260730_001` | Created alongside profiles but no app code | Wire in for user prefs or drop |

## Shared Tables (Not Owned by This App)

| Table | Owner | How Used | Risk |
|-------|-------|----------|------|
| `work_orders` | Duck Force / Power Automate | Read by `fetchRForceOrders()`, `fetchAccountSuggestions()`; written by `updateSchedulerNotes()` | App depends on external table schema; writes to a table it doesn't own |
| `time_off_requests` | Duck Force | Read and written by scheduling app | Shared resource, no namespace isolation |
| `csv_imports` | Duck Force (probable) | Referenced by migration 005 FK | May not exist as expected |

## RLS Security Summary

### Tables allowing anonymous access (no auth required):

| Table | Policy |
|-------|--------|
| `sched_crews` | `FOR ALL USING (true)` — original RLS |
| `sched_appointments` | `FOR ALL USING (true)` — original RLS |
| `sched_csv_imports` | `FOR ALL USING (true)` — original RLS |
| `sched_rforce_orders` | `FOR ALL USING (true)` — original RLS |
| `sched_settings` | `FOR ALL USING (true)` — original RLS |
| `sched_availability_rules` | Anon policies added in `20260806_001_fix` |
| `sched_availability_exceptions` | Anon policies added in `20260806_001_fix` |
| `sched_appointment_events` | Anon policies added in `20260806_002_anon` |
| `sched_appointment_links` | Anon policies added in `20260806_002_anon` |
| `sched_flag_resolutions` | Anon policies added in `20260806_002_anon` |

### Tables with NO RLS at all:

| Table | Risk |
|-------|------|
| `sched_geocode_cache` | Completely unprotected — anyone can read/write geocode data |

### Tables properly restricted to authenticated users:

`sched_profiles`, `sched_user_preferences`, `sched_appointment_resources`, `sched_flags`, `sched_resource_mappings`, `sched_reconciliation_results`, `sched_rforce_dismissals`, `sched_import_snapshots`, `sched_match_rejections`

## TypeScript vs Database Column Comparison (`sched_appointments`)

### Columns TypeScript expects but may not exist:

| Column | Migration | Code Fallback |
|--------|-----------|---------------|
| `tertiary_crew_id` | **NONE** — phantom column | Referenced without guard |
| `origin` | `20260806_002` | `try/catch` in `approveRForceOrder` |
| `sync_state` | `20260806_002` | `try/catch` in `approveRForceOrder` |
| `original_entry_snapshot` | `20260806_002` | Stripped from `updateAppointment` |
| `last_reconciled_import_id` | `20260806_002` | Stripped from `updateAppointment` |

### Columns in migrations but NOT in TypeScript `Appointment` type:

| Column | Migration |
|--------|-----------|
| `created_by` | `20260730_002` |
| `updated_by` | `20260730_002` |
| `cancelled_by` | `20260730_002` |
| `cancelled_at` | `20260730_002` |
| `cancellation_reason` | `20260730_002` |
| `last_rescheduled_at` | `20260730_002` |

## Data Quality Checklist (Re-verify Before Migration)

- [ ] Total appointment count (was ~587)
- [ ] Active appointment count (was ~583)
- [ ] Active link count (was ~552)
- [ ] Unlinked active appointments (was ~31)
- [ ] Work order record count (was ~22,900)
- [ ] Resource mapping count (was 0)
- [ ] Reconciliation result count (was 0)
- [ ] Geocode cache count (was 0)
- [ ] Duplicate work order numbers in appointments
- [ ] Orphaned links (link points to deleted/cancelled appointment)
- [ ] Past completed records still marked 'scheduled'
- [ ] Appointments with rForce-cancelled WOs still active
