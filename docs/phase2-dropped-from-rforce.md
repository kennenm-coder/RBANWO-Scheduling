# Phase 2 — "Dropped from rForce" cancellation detection

**Status:** Implemented (2026-08-27) via the daily-export-count model below —
a lighter path than the tracked-import-endpoint plan originally sketched here.

## What shipped (two-tier, export-count model)

rForce cancellations arrive as absence from the **full export**. Since 2026-09-28
the Power Automate feed runs **hourly, 8am–5pm**, and every run is a full refresh
of the active set (before that it was every two hours, 8am–2pm). We still count at
**day** grain — all of a day's runs stamp the same `updated_at` date, so a day is
the finest miss the table can express — and escalate in two tiers:

- **missed 1 export → 🟡 possible cancel** — amber tag on the overlay tile only
  (`ApprovalCard`, driven by `RForceDisplayItem.stale` / `dropTier`).
- **missed ≥2 exports → 🔴 likely cancel** — red tile tag **and** the Issue
  Center "Dropped from rForce" review (`deriveDroppedTiles`).

Because each export overwrites `updated_at`, the work_orders table can't retain
which days an export ran. Rather than route Power Automate through a tracked
endpoint (the original plan below), the app **records the export date it observes
on load** into `sched_import_runs` (see `detectLatestExportDate` +
`recordImportRun`); miss-counting reads that log (`missedExportCount` /
`dropTier` in `src/lib/rforce-staleness.ts`). A day the export fails simply never
enters the log, so it isn't counted as a miss (gap-safe). Thresholds live as
`MISSED_EXPORTS_FOR_AMBER` / `MISSED_EXPORTS_FOR_RED`. Completed (`status:
"complete"`) tiles are explicitly excluded so finished jobs stay for record
keeping. History accumulates forward from launch; before ~2 exports are logged,
tiles under-escalate (amber, never a false red) — an acceptable cold start.

## Invariant: the feed must keep upserting the FULL active set

This whole model infers "still in rForce" from "an import touched this row". The
calendar app's `/api/upload` therefore re-upserts **every** order on **every** run
and bumps `updated_at`, whether or not anything changed. That looks like waste and
is a standing temptation to optimize — the diff needed to narrow it is already
computed there for the import log.

**Don't.** Narrowing the feed to changed rows only would mean an unchanged but
perfectly live order stops having its `updated_at` bumped, so within two days it
accumulates 2 missed exports and escalates to 🔴 likely cancel. The failure mode is
a wall of false cancellations across the board, not a subtle regression. Changing
the write pattern requires replacing this detection model first (see the tracked-
import plan below, which is exactly that replacement).

The original tracked-import plan is retained below for reference; it remains the
most precise option if the client-side detection ever proves too coarse.

---

**Original plan (superseded, kept for reference):**

## What Phase 1 does today

Cancelled rForce jobs don't arrive as cancellations — they simply stop appearing in
imports. Phase 1 catches this with a **heuristic**: an order whose `updated_at` has
fallen more than `STALE_THRESHOLD_MS` (48h) behind the newest imported order is
treated as "dropped."

- Detection: `deriveDroppedTiles()` in [`src/lib/issues.ts`](../src/lib/issues.ts),
  using `isOrderStale` / `latestImportTime` from
  [`src/lib/rforce-staleness.ts`](../src/lib/rforce-staleness.ts).
- Surface: the **"Dropped from rForce"** category on the `/issues` page
  ([`src/app/issues/page.tsx`](../src/app/issues/page.tsx)) with **Cancel tile**
  (soft-cancel, preserves history), **Keep tile** (suppress via
  `sched_rforce_dismissals`), and **Open rForce**.
- Guards: only **active, upcoming (today-onward), linked** tiles; skips explicitly
  cancelled/completed orders (handled by the Issue Center's
  `rforce_cancellation_mismatch`) and already kept/dismissed tiles.

## Why Phase 1 is only a heuristic (the limitation)

The `updated_at` signal can't distinguish **"missing from a complete import"** from
**"the import was partial / never finished."** A filtered or partial rForce export
advances only some orders' `updated_at`, which can make unrelated jobs look dropped.
Phase 1 mitigates this (import-stopped is safe; past jobs excluded; never
auto-cancels), but it can't count real consecutive absences.

Root cause: the Power Automate path writes to `work_orders` **directly**, bypassing
the app's import tracking — see the "bypass" note in
[`src/lib/import-boundary.ts`](../src/lib/import-boundary.ts). So there is no record
of *which* work orders were present in *which* complete import.

## Phase 2 plan (do this for precise detection)

1. **Route Power Automate through tracked imports.** Add an ingestion endpoint
   (e.g. `POST /api/import`) that calls `importCsv()` and records the import, then
   reconfigure the Power Automate flow to POST the CSV there instead of writing
   `work_orders` directly. This is the prerequisite — without it the app can't tell a
   complete import from a partial one.
2. **Record full import membership.** Today `sched_import_snapshots` only stores
   *new/changed* orders. Add a lightweight record of **every** WO number present in
   each successful import (new table, e.g. `sched_import_membership(import_id,
   work_order_number)`), and mark imports that represent a **complete** schedule
   export.
3. **Count consecutive misses.** For each active linked tile, track `last_seen_import`
   and a `missed_import_count`. Increment only when the WO is absent from a
   **complete** import; reset to 0 when it reappears.
4. **Flag after N misses** (~2 complete imports, or 24–48h) instead of the `updated_at`
   heuristic. Store the scheduler's decision (Cancel / Keep) and auto-clear the flag
   if the order reappears; re-open if it drops again after a "Keep."
5. **Optional:** also light up the pre-stubbed `source_record_missing` flag in
   [`src/lib/flags.ts`](../src/lib/flags.ts) so the same review appears in the Issue
   Center (the code, icon, category, and acknowledge lifecycle already exist for it —
   it is defined but never emitted).

## Safeguards to preserve in Phase 2

- Only evaluate **complete** schedule exports (never partial/filtered reports).
- Require **≥2 missed complete imports** before flagging (protects against a single
  failed/incomplete upload).
- **Never auto-cancel** — always an explicit scheduler action.
- Persist `last_seen_import`, `missed_import_count`, and the user's decision.
- Auto-clear when the order reappears.
