# Installer Utilization — Implementation Plan

Last updated: October 8, 2026
Status: **plan only — view-only feature, no code written yet**

## Goal

A fifth tab, visible only to **admin** and **scheduling_manager**, that answers one question
per installer per day: *is this person carrying a full day of work?*

The measure is **product workload**, not calendar occupancy. A day with five 2-unit jobs is
not a full day, and the current calendar cannot tell you that. Product and frame-type detail
comes from the material-list app (`nwo-material-list-maker`), which already publishes a
finished document for every submitted job.

Primary view is a **per-day grid** — installers down, days across — so an under-utilized day
is visible at a glance. The range rollup is a summary column, not the headline.

---

## The point system

Calibrated from the anchors Kennen set: 6 inserts, 4 full frames, or 2 entry/patio doors is
one full day. Those resolve to clean integers on a **12-point day**.

| Product | Insert (IF) | Full frame (FF) | EJ frame |
|---|---|---|---|
| Window (DH, casement, slider, …) | **2** | **3** | 3 |
| Specialty shape | 3 | 4 | 4 |
| Patio door | — | **6** | — |
| Entry door | — | **6** | — |
| Storm door | — | 2 | — |
| Screen | — | 1 | — |

**Full day = 12 points.** Bolded cells are the direct anchors; the rest are derived from the
1.5x insert-to-full-frame ratio and are first-draft guesses to be tuned.

Every combination adds up predictably: 3 inserts + 2 full frames = 6 + 6 = 12 = one day.
2 entry doors = 12 = one day. 6 inserts = 12 = one day.

Stored in a `sched_load_weights` table so retuning is a data change, never a deploy.
"Base frame" maps to insert and "EJ frame" to its own column, matching `abbreviateFrame()`
in the material-list app's `lib/parsers.js`.

---

## Data sources

All of these live in the **same** Supabase project (`xusqjotoyntnfysquvlv`), so this is a
read, not an integration.

| Source | Gives us |
|---|---|
| `sched_appointments` | who, when, span, lead/helper, type, status |
| `sched_crews` + availability rules / exceptions / time-off / calendar blocks | the capacity denominator |
| `install_docs` | the product detail — `doc.units[]`, read **once per job save** by trigger, never at query time |
| `sched_install_tally` | what the page actually reads: 8 smallint counters per order |

### The join

`install_docs.order_number` is written from `job.poNumber` by the material-list app's
`upsertInstallDoc()`. `sched_appointments.order_number` is the same value.

This join is already proven in production by Duck Force:
`orders.find((o) => o.orderNumber === job.job.poNumber)` in
`Betterthengooglecal/src/components/UnscheduledJobs.tsx:29`.

### The product rollup

Each `doc.units[]` entry carries `qty` / `summaryQty`, `abbrev` / `summaryAbbrev`
(W / PTD / ED / SD / SN / specialty) and `summaryFrameType` / `frame`. Misc units with qty 0
are already dropped by the builder; remaining misc units are excluded here.

This tab needs **only the tally** — never the product lines. Eight counters per job:

```
windows_if, windows_ff, windows_ej, specialty, patio_doors, entry_doors, storm_doors, screens
```

`nwoRows` and `boardSummary` are never read by this feature at all.

### RLS — nothing new needed

`install_docs` selects on `is_allowlisted()` (calendar repo, `023_install_docs.sql`).
Scheduling users are on `allowed_emails`, so reads already work.

---

## No fallback for missing material lists

Decided: **every job will have a material list going forward.** A job without one is
excluded — no rForce product-count estimate, no "approximate" rows.

But an excluded job still occupies the installer's day. Dropping its load while leaving its
day in the denominator would make that installer read *artificially under-utilized* — the
exact wrong signal on the one tab whose job is spotting under-utilization. So exclusion is
at the **day** level, and it is always visible rather than silent.

### Day classification

For every (installer, date) pair in the range:

| Class | In denominator? | Load | Shown as |
|---|---|---|---|
| `measurable` | yes, 12 pts | from docs | the normal colored cell |
| `idle` | yes, 12 pts | 0 | the under-utilization signal |
| `non_install` | yes, 12 pts | 0 | "service / JIP / LSWP day" — consumes the day, carries no product |
| `unmeasured` | **no** | — | hatched cell + flag; the job is named so somebody can go build the list |
| `off` | **no** | — | greyed (PTO, holiday, company meeting, unavailable) |

A day is `unmeasured` if **any** install tile standing on it lacks a material list. An
installer whose whole range is unmeasured legitimately shows blank — the truthful answer.

The flagged jobs are listed by order number and customer, which turns this tab into a useful
nag list for missing material lists as a side effect.

---

## Attribution rules

- **Lead** (`crew_id`) carries the job's full load.
- **Multi-day** jobs spread load evenly across `getSpannedDates()`, so a 3-day / 36-point job
  reads 12/day instead of spiking on day 1. *(Assumption — day 1 of a full-frame job is
  genuinely heavier than day 3. Even spreading keeps the daily grid readable; revisit if the
  numbers feel wrong.)*
- **Helpers** (`secondary_crew_id` / `tertiary_crew_id`, honoring `secondary_day_offsets`)
  are not in scope for v1 — in-house and sub **leads** only.
- Per-day expansion reuses the existing `sched_crew_days()` SQL function, the same one the
  conflict guard and `work_orders.day_crews` use, so metrics cannot drift from the calendar.

### Counted tiles

`scheduled`, `confirmed`, `in_progress`, `complete`. Not `cancelled`, `rescheduled`, or
`unscheduled` (queue tiles have no date).

### Resources in scope

`crew_type` in (`install_in_house`, `install_sub`), `is_active = true`. Multi-department rows
roll up by person, not by crew row.

---

## Targets

- One company-wide target: **12 points/day**, in a settings row.
- One company-wide goal threshold: **85%** — below that is flagged under-utilized.
- A per-installer `target_points_per_day` override column exists but stays empty in v1.

---

## Schema changes

One migration, `20261008_001_installer_utilization.sql`:

1. `sched_load_weights (product_key, frame_key, points, updated_at)` — seeded with the table
   above.
2. `sched_utilization_settings` — single row: `target_points_per_day` (12),
   `goal_utilization_pct` (85).
3. `sched_crew_targets (crew_id, target_points_per_day)` — empty; per-installer override.
4. `sched_install_tally` — the precomputed unit tally, **one narrow row per order**:
   `order_number` (PK), `job_id`, `windows_if`, `windows_ff`, `windows_ej`, `specialty`,
   `patio_doors`, `entry_doors`, `storm_doors`, `screens`, `total_units`, `built_at`.
   All smallints. Indexed on `order_number`.
5. `sched_build_install_tally(p_doc jsonb)` — pure function, walks `doc->'units'` once and
   returns the tally.
6. A trigger on `install_docs` (insert or update of `doc`) that calls it and upserts
   `sched_install_tally`. Plus a one-time backfill `UPDATE` for existing rows.

### Why a trigger and not a query-time rollup

The first draft of this plan had a `SECURITY DEFINER` function aggregating
`install_docs.doc->'units'` on demand. Wire-efficient, but wrong on database cost: `doc` is
fat (units + nwoRows + boardSummary), so it lives in TOAST storage, and reading
`doc->'units'` de-TOASTs the **entire document** for every job in range. That cost would be
paid again on every page load, every refresh, every range change.

Tallying on write instead pays it once per job save — and material-list saves are far rarer
than manager page views. The metrics page then reads a narrow table of smallints: kilobytes,
not megabytes, and flat no matter how often the tab is opened.

Points are **not** stored in the tally. They are computed client-side in `utilization.ts`
from the tally plus `sched_load_weights`, so retuning a weight re-reads nothing and
rebuilds no rows.

### Why we are NOT restructuring the material-list storage

Asked and answered during planning: should `nwo-material-list-maker` normalize `units` into
relational tables instead of storing them in jsonb? **No.**

The blob is load-bearing, not accidental. That app's CLAUDE.md requires the document to be a
*locked record* of what was configured and ordered — no mass rebuild, old jobs keep their
version, snapshot semantics like the PDF. Normalizing against a live catalog would
retroactively rewrite old deals, which is explicitly unwanted. The denormalized snapshot is
the correct implementation of that requirement.

Cost of changing it anyway: four apps read the shape (material-list, Duck Force, Job
Auditor, scheduling), plus an offline sync queue doing whole-row overwrites that has already
caused one stale-overwrite bug (documented in `storage.js`). It would mean rewriting the
builder, the PDF generator, the on-screen reports, `calendar_jobs()`, both consumers' install
pages, and the offline conflict handling — and would buy this feature nothing the trigger
does not already give it.

**Correction to an earlier draft of this plan:** `install_docs.doc` excludes the multi-MB
`originalImport` blob — `HEADER_FIELDS` in `installDoc.js` is an allowlist written
specifically to keep it out. Docs are therefore likely tens of KB, not megabytes. The TOAST
argument above still holds, but the problem is "wasteful and recurring," not urgent.

Separate, unrelated issue worth its own project someday: `jobs.data` *does* carry
`originalImport`, and that row is whole-row overwritten on every save, so every edit rewrites
megabytes that did not change. `calendar_jobs()` (migration 022) works around it for readers;
writers still pay. Not a prerequisite for this tab, and deliberately not bundled with it.

### Why this needs no change in the material-list app

The trigger derives the tally from `doc`, so `nwo-material-list-maker` keeps calling
`upsertInstallDoc()` exactly as it does today and stays unaware this exists. No cross-repo
coordination, and no risk of the two apps disagreeing about the count.

Precedent for both halves already exists: `install_docs` carries a trigger today
(`trg_install_docs_touch_updated_at`), and this app already owns a trigger-maintained
projection on a table it does not own (`work_orders.day_crews`, migration
`20261001_002`). The `INSTALL_DOC_VERSION` contract is respected — the tally reads only
`units`, which is stable across doc versions.

RLS: read-only for any scheduling role; the trigger runs **SECURITY DEFINER** since the
writer holds permission on `install_docs`, not on `sched_install_tally`.

---

## Client modules

| File | Responsibility |
|---|---|
| `src/lib/utilization.ts` | pure: points from a product rollup, day classification, capacity, utilization % |
| `src/lib/utilization.test.ts` | the anchors as test cases — 6 IF, 4 FF, 2 ED each equal exactly 12 |
| `src/lib/utilization-store.ts` | fetch appointments + tallies + weights + targets for a range |
| `src/app/metrics/page.tsx` | the page |
| `src/components/UtilizationGrid.tsx` | the per-day grid |
| `src/components/UtilizationDayDetail.tsx` | drill-down for one (installer, day) |

`utilization.ts` stays a leaf module with no imports from the store, so the math is testable
in isolation — same discipline as `scheduling-limits.ts`.

Data is fetched by the page, **not** added to `DataProvider`. That provider already loads a
lot for every route; a manager-only tab should not tax the calendar's startup.

### Database cost per page load

Three small reads, all indexed, none touching `install_docs`:

1. `sched_appointments` for the range, install types, live statuses — the window the calendar
   already loads routinely.
2. `sched_install_tally` filtered to those orders — a few hundred rows of smallints.
3. `sched_load_weights` + settings + targets — a few dozen rows, cacheable for the session.

No jsonb is read at query time and no document is de-TOASTed. Changing the date range or
re-sorting the grid re-reads (1) and (2) only; weight retuning re-reads nothing, because
points are computed client-side.

*Caveat: real `doc` sizes were never measured — the anon key is blocked by RLS, so prod
could not be inspected while planning. The TOAST argument holds regardless of the exact
size, and the trigger design makes the number irrelevant.*

---

## The page

**Header** — date range picker (default **next 4 weeks**, free to go either direction),
company target, goal threshold, coverage line ("3 jobs excluded, no material list").

**Grid** — installers down, days across. Each cell shows that day's points against 12,
colored by band:

- red — under 70%
- amber — 70% to the goal threshold (85%)
- green — at or above goal
- blue — over 110% (overloaded, the opposite problem but worth seeing)
- grey — `off`; hatched + flag icon — `unmeasured`

**Row summary** (right, sticky) — total points / capacity, utilization %, count of
under-utilized days, count of unmeasured days.

**Sorting** — ascending by utilization so the under-utilized float to the top.

**Drill-down** — tap a cell to see that day's jobs with per-job point breakdown and product
mix; tap a flagged cell to see which order is missing a material list.

**Mobile** — this app is mobile-first (bottom nav, safe-area insets). ~12 installers x 20
working days does not fit a phone, so: sticky installer-name column, horizontal scroll, and a
week-at-a-time pager. Desktop shows the full range.

---

## Gating

- `NAV_ITEMS` in `BottomNav.tsx` gains a fifth entry, filtered by `canManage(role)` from
  `lib/auth.ts` — which already means exactly admin + scheduling_manager.
- `/metrics` **also** gates itself and renders a no-access panel. Hiding a nav link is not a
  gate; anyone can type the URL.
- Nav goes from 4 items to 5 for managers and stays at 4 for everyone else.

---

## Phasing

**Phase 1 — view only — BUILT, migration not yet applied**

| | |
|---|---|
| `supabase/migrations/20261008_001_installer_utilization.sql` | **not applied** — see below |
| `src/lib/utilization.ts` | the math, leaf module |
| `src/lib/utilization.test.ts` | 36 tests, including the three anchors |
| `src/lib/utilization-store.ts` | the three reads + the off-day lookup |
| `src/app/metrics/page.tsx` | the page, self-gated |
| `src/components/UtilizationGrid.tsx` | the per-day grid |
| `src/components/UtilizationDayDetail.tsx` | the drill-down |
| `src/components/BottomNav.tsx` | **the only edited file** — fifth tab, `canManage` gated |

Verified: 621 tests pass, clean typecheck, clean production build, and the page
was rendered against fixtures through the real `computeUtilization` →
`UtilizationGrid` pipeline on desktop and at phone width.

**The app is safe to deploy before the migration is applied.** The page reads
tables that do not exist yet, catches the error and says so, naming the
migration. No other route touches any of this. The nav item only appears for
manager and admin.

Still unverified, and only verifiable after the migration is applied: the real
join rate between `sched_appointments.order_number` and
`install_docs.order_number`. The join is the one Duck Force already uses, but
how many install tiles actually hit a material list in practice is a question
only live data answers. The coverage line at the top of the page reports it.

**Phase 2 — tuning UI**
Admin editors in Settings for the weight table, the company target, and per-installer
overrides. Until then those are data changes in SQL.

**Phase 3 — make it actionable**
Surface "who is light" on the Queue when assigning a job; trend over time.

---

## Open assumptions

1. **Even multi-day spreading** — stated above; the alternative is front-loading the span.
2. **Specialty / storm door / screen / EJ points** are derived guesses, not confirmed numbers.
3. **`late_day` and `office_day`** currently produce `available: false` in `availability.ts`,
   so they land in `off` and shrink capacity. Consistent with the calendar, but a late day is
   not really a day off — may want partial capacity later.
4. **Sub crews** are in scope, which assumes their jobs get material lists too.
5. **The tally is derived data**, so it carries the usual costs: the one-time backfill is the
   single moment every document is read, and if a future `INSTALL_DOC_VERSION` changes the
   shape of `units`, `sched_build_install_tally()` must be updated with it. `units` has been
   stable across versions so far, but this is a real coupling to the material-list app, not a
   clean break from it.
