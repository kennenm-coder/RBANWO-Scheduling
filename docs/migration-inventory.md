# Database Migration Inventory

Last audited: 2026-08-06

## Tables Created by Migrations

| # | Migration | Table | Purpose |
|---|-----------|-------|---------|
| 1 | `20260730_001` | `sched_profiles` | User profiles with roles (scheduler/manager/admin/read_only) |
| 1 | `20260730_001` | `sched_user_preferences` | Per-user UI preferences (theme, view, density, filters) |
| 2 | `20260730_002` | `sched_appointment_events` | Audit trail for appointment mutations |
| 3 | `20260730_003` | `sched_appointment_resources` | Multi-resource assignments (primary/second/third/helper) |
| 4 | `20260730_004` | `sched_availability_rules` | Recurring availability (PTO, unavailable, role, blocks) |
| 4 | `20260730_004` | `sched_availability_exceptions` | Per-date overrides on availability rules |
| 5 | `20260730_005` | `sched_flags` | Persistent flag/issue records (manual + automatic) |
| 8 | `20260803_001` | `sched_appointment_links` | App↔rForce work-order links with uniqueness constraints |
| 9 | `20260803_002` | `sched_resource_mappings` | rForce name → app crew-ID mappings |
| 11 | `20260803_004` | `sched_reconciliation_results` | Computed sync status per link |
| 12 | `20260804_001` | `sched_rforce_dismissals` | Dismissed rForce approval prompts |
| 13 | `20260804_002` | `sched_flag_resolutions` | Issue Center flag acknowledgments |

## Tables Modified by Migrations

| # | Migration | Table | Changes |
|---|-----------|-------|---------|
| 2 | `20260730_002` | `sched_appointments` | Added audit columns (created_by, updated_by, cancelled_by/at/reason, last_rescheduled_at) |
| 6 | `20260730_006` | `sched_geocache` | Added precision, state, provider, validation columns (conditional—only if table exists) |
| 7 | `20260731_001` | `sched_appointments` | Added manual_override, override_source, time_block_end |
| 7 | `20260731_001` | `sched_appointment_events` | Expanded action CHECK (drag_moved, drag_resized) |
| 8b | `20260731_005` | `sched_availability_rules` | Added repeat_interval column |
| 14 | `20260805_001` | `sched_appointments` | Added 'unscheduled' status, made crew_id/date/times nullable, merge_source_wo |
| 14 | `20260805_001` | `sched_appointment_events` | Expanded action CHECK (approved_from_rforce, unscheduled, merged) |
| 15 | `20260806_001` | `sched_geocode_cache` | Added precision, provider, manual_override, updated_at |

## Data Migrations

| # | Migration | Action |
|---|-----------|--------|
| 3 | `20260730_003` | Backfills `sched_appointment_resources` from existing crew_id, secondary_crew_id, tertiary_crew_id |
| 10 | `20260803_003` | Backfills `sched_appointment_links` from appointments with matching work_order_number in work_orders |

## Functions Created

| Migration | Function | Purpose |
|-----------|----------|---------|
| `20260803_004` | `reconcile_linked_appointments()` | Server-side comparison of app vs rForce data per active link |

## Pre-existing Tables (not created by migrations)

These tables exist in Supabase but were created outside the migration history:

| Table | Purpose | Notes |
|-------|---------|-------|
| `sched_appointments` | Core appointment records | Modified by migrations 002, 007, 014 |
| `sched_crews` | Crew/resource definitions | Referenced by FK in several migrations |
| `work_orders` | rForce CSV import target | Referenced by backfill and reconciliation |
| `sched_geocache` / `sched_geocode_cache` | Address geocoding cache | ⚠️ **Naming inconsistency** — migration 006 targets `sched_geocache`, migration 015 targets `sched_geocode_cache`. Need to verify which name exists in production. |
| `time_off_requests` | External time-off data | Not prefixed with `sched_` |
| `csv_imports` | Import tracking | Basic import metadata |

## Known Issues

1. **Geocache table name mismatch**: Migration `20260730_006` references `sched_geocache` (with conditional IF EXISTS), while migration `20260806_001` references `sched_geocode_cache`. The actual deployed table needs verification.

2. **Missing RLS on newer tables**: `sched_rforce_dismissals` and `sched_flag_resolutions` have no RLS policies — currently wide open.

3. **Inconsistent naming**: `time_off_requests` doesn't follow the `sched_` prefix convention.

4. **`sched_flags` table vs. client-side flags**: Migration 005 created a `sched_flags` table for persistent flags, but the current app computes flags client-side via `detectFlags()` in `flags.ts`. The persistent table is unused — the client-side approach is more correct for live-app flags (auto-clear), but external/workflow flags should eventually be persisted.

5. **Anonymous/unauthenticated access**: Several RLS policies use `to authenticated using (true)` which allows any authenticated user full access. No policies exist for the `anon` role, but the app currently works without authentication in dev.
