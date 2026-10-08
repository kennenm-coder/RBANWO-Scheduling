-- ============================================================
-- Installer utilization — schema, weights and the install tally
--
-- Backs the manager-only /metrics tab. See INSTALLER_UTILIZATION_PLAN.md.
--
-- The point of this migration is to make the metrics page cheap to open. The
-- product detail it needs lives in install_docs.doc, a fat jsonb (units +
-- nwoRows + boardSummary) written by the material-list app. Reading
-- doc->'units' de-TOASTs the WHOLE document, so aggregating at query time
-- would pay that cost on every page load, every refresh, every range change.
--
-- Instead a trigger tallies each document ONCE, on save, into
-- sched_install_tally — twelve smallints per job. The page reads only that.
-- Material-list saves are far rarer than manager page views.
--
-- The material-list app needs NO change: the trigger derives the tally from
-- the doc it already writes, so nwo-material-list-maker stays unaware this
-- exists and the two can never disagree about a count.
--
-- Points are deliberately NOT stored here. They are computed client-side in
-- src/lib/utilization.ts from the tally plus sched_load_weights, so retuning a
-- weight re-reads nothing and rebuilds no rows.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- ── Applying this to the live database ─────────────────────────────────────
-- Everything here is additive: four NEW tables, two NEW functions, one NEW
-- trigger. No existing table, column, policy or function is altered or
-- dropped, so nothing the scheduling app, Duck Force, the Job Auditor or the
-- material-list app does today changes behavior.
--
-- The one thing that touches a live write path is the trigger on install_docs
-- (section 6). It is wrapped in an exception handler that can never fail a job
-- save — see the comment there, it is the most important part of this file.
--
-- Creating the trigger takes a brief ACCESS EXCLUSIVE lock on install_docs, so
-- a job being saved at that exact moment waits a fraction of a second. Apply it
-- when the office is not mid-save if you want to be careful. The backfill in
-- section 9 reads every document once; on a few thousand rows that is seconds.
--
-- Rollback, should it ever be wanted, is at the very bottom of this file.
-- ============================================================

BEGIN;

-- ── 1. Point weights ────────────────────────────────────────────────────────
-- A full install day is 12 points. Calibrated from the anchors Kennen set:
-- 6 inserts, 4 full frames, or 2 entry/patio doors is one full day.
--
--   insert window 2 × 6 = 12     full-frame window 3 × 4 = 12
--   entry door    6 × 2 = 12     patio door        6 × 2 = 12
--
-- Any mix adds up predictably: 3 inserts + 2 full frames = 6 + 6 = 12.
--
-- A table rather than constants so retuning is a data change, never a deploy.
CREATE TABLE IF NOT EXISTS sched_load_weights (
  product_key TEXT NOT NULL,
  frame_key   TEXT NOT NULL,
  points      NUMERIC(5,2) NOT NULL CHECK (points >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_key, frame_key),
  CHECK (product_key IN ('window','specialty','patio_door','entry_door','storm_door','screen','other')),
  CHECK (frame_key   IN ('IF','FF','EJ','NA'))
);

COMMENT ON TABLE sched_load_weights IS
  'Points per product x frame type. 12 points = one full install day. Tunable without a deploy; read by src/lib/utilization.ts.';

-- Seeded only when empty, so re-running never stomps tuned values.
INSERT INTO sched_load_weights (product_key, frame_key, points)
SELECT * FROM (VALUES
  -- Kennen's direct anchors
  ('window',     'IF', 2.0),
  ('window',     'FF', 3.0),
  ('entry_door', 'NA', 6.0),
  ('patio_door', 'NA', 6.0),
  -- Derived from the 1.5x insert->full-frame ratio. FIRST-DRAFT GUESSES,
  -- pending Kennen's real numbers.
  ('window',     'EJ', 3.0),
  ('specialty',  'IF', 3.0),
  ('specialty',  'FF', 4.0),
  ('specialty',  'EJ', 4.0),
  ('storm_door', 'NA', 2.0),
  ('screen',     'NA', 1.0),
  -- Unrecognized abbrevs score zero but stay counted and visible, so a new
  -- product type in the material-list app shows up as "other" instead of
  -- silently deflating somebody's utilization.
  ('other',      'NA', 0.0)
) AS v(product_key, frame_key, points)
WHERE NOT EXISTS (SELECT 1 FROM sched_load_weights);

-- ── 2. Company targets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sched_utilization_settings (
  id                     BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  target_points_per_day  NUMERIC(5,2) NOT NULL DEFAULT 12 CHECK (target_points_per_day > 0),
  goal_utilization_pct   SMALLINT     NOT NULL DEFAULT 85 CHECK (goal_utilization_pct BETWEEN 1 AND 200),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE sched_utilization_settings IS
  'Single-row company settings for the utilization tab. The id CHECK(id) pins it to exactly one row.';

INSERT INTO sched_utilization_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Per-installer target override ───────────────────────────────────────
-- Empty in v1 — everyone uses the company number. The column exists so Phase 2
-- can add an editor without another migration.
CREATE TABLE IF NOT EXISTS sched_crew_targets (
  crew_id               UUID PRIMARY KEY REFERENCES sched_crews(id) ON DELETE CASCADE,
  target_points_per_day NUMERIC(5,2) CHECK (target_points_per_day > 0),
  notes                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. The tally ───────────────────────────────────────────────────────────
-- Keyed on job_id (install_docs' own PK) rather than order_number, which is
-- nullable and not guaranteed unique — a re-created job can reuse a PO. The
-- client joins on order_number and takes the newest built_at when two tallies
-- share one.
CREATE TABLE IF NOT EXISTS sched_install_tally (
  job_id        TEXT PRIMARY KEY,
  order_number  TEXT,
  windows_if    SMALLINT NOT NULL DEFAULT 0,
  windows_ff    SMALLINT NOT NULL DEFAULT 0,
  windows_ej    SMALLINT NOT NULL DEFAULT 0,
  specialty_if  SMALLINT NOT NULL DEFAULT 0,
  specialty_ff  SMALLINT NOT NULL DEFAULT 0,
  specialty_ej  SMALLINT NOT NULL DEFAULT 0,
  patio_doors   SMALLINT NOT NULL DEFAULT 0,
  entry_doors   SMALLINT NOT NULL DEFAULT 0,
  storm_doors   SMALLINT NOT NULL DEFAULT 0,
  screens       SMALLINT NOT NULL DEFAULT 0,
  other_units   SMALLINT NOT NULL DEFAULT 0,
  total_units   SMALLINT NOT NULL DEFAULT 0,
  doc_version   SMALLINT,
  built_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sched_install_tally_order
  ON sched_install_tally (order_number);

COMMENT ON TABLE sched_install_tally IS
  'Precomputed unit counts per install_docs row, maintained by trigger. Derived data — rebuild with the backfill at the bottom of migration 20261008_001. Never written by the app.';

-- ── 5. The tally builder ───────────────────────────────────────────────────
-- Mirrors the material-list app's OWN classifier so the counts can never
-- disagree with what the office sees:
--
--   calcConsumableQty()     lib/materials.js:1825
--   MC_*_ABBREVS            lib/constants.js:105
--   buildAutoSummaryFromUnits()  lib/parsers.js:1055
--
-- Three details taken from that code rather than assumed:
--   • ONE UNIT PER ROW. Real window/door units carry no `qty` field at all;
--     buildAutoSummaryFromUnits counts rows (qty: 1, then g.qty += 1). Summing
--     a `qty` column here would return zeros.
--   • `frame` is ALREADY abbreviated to FF / IF / BF / EJ by abbreviateFrame().
--   • Units with an empty abbrev are skipped, and isMisc units are excluded
--     entirely — both exactly as buildAutoSummaryFromUnits does.
--
-- Two DELIBERATE divergences from their engine, both made explicit as weight
-- rows so they are tunable rather than buried:
--   • Their consumable engine collapses EJ into insert (anything not 'FF').
--     An EJ frame is full-frame work, so it gets its own key here, weighted
--     like FF. Set window/EJ to 2.0 to match their behavior instead.
--   • Their engine ignores SD and SN entirely (no consumables). Storm doors
--     and screens are real install work, so they are counted and weighted.
CREATE OR REPLACE FUNCTION sched_build_install_tally(p_doc jsonb)
RETURNS TABLE (
  windows_if   INT, windows_ff   INT, windows_ej   INT,
  specialty_if INT, specialty_ff INT, specialty_ej INT,
  patio_doors  INT, entry_doors  INT, storm_doors  INT, screens INT,
  other_units  INT, total_units  INT
)
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH raw AS (
    SELECT
      upper(btrim(coalesce(elem->>'abbrev', ''))) AS abbrev,
      upper(btrim(coalesce(elem->>'frame',  ''))) AS frame
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_doc->'units') = 'array'
                THEN p_doc->'units'
                ELSE '[]'::jsonb
           END
         ) AS elem
    WHERE coalesce((elem->>'isMisc')::boolean, false) = false
      AND btrim(coalesce(elem->>'abbrev', '')) <> ''
  ),
  classified AS (
    SELECT
      CASE
        WHEN abbrev IN ('ED','IE') THEN 'entry_door'
        WHEN abbrev = 'PTD'        THEN 'patio_door'
        WHEN abbrev = 'SD'         THEN 'storm_door'
        WHEN abbrev = 'SN'         THEN 'screen'
        WHEN abbrev = 'SPW'        THEN 'specialty'
        WHEN abbrev IN ('CS','CD','CT','DG','PW','FC','AN','GL','GT') THEN 'window'
        ELSE 'other'
      END AS product,
      -- BF (base frame) and blank both read as insert, matching their engine.
      CASE WHEN frame = 'FF' THEN 'FF'
           WHEN frame = 'EJ' THEN 'EJ'
           ELSE 'IF'
      END AS fr
    FROM raw
  )
  SELECT
    count(*) FILTER (WHERE product = 'window'    AND fr = 'IF')::int,
    count(*) FILTER (WHERE product = 'window'    AND fr = 'FF')::int,
    count(*) FILTER (WHERE product = 'window'    AND fr = 'EJ')::int,
    count(*) FILTER (WHERE product = 'specialty' AND fr = 'IF')::int,
    count(*) FILTER (WHERE product = 'specialty' AND fr = 'FF')::int,
    count(*) FILTER (WHERE product = 'specialty' AND fr = 'EJ')::int,
    count(*) FILTER (WHERE product = 'patio_door')::int,
    count(*) FILTER (WHERE product = 'entry_door')::int,
    count(*) FILTER (WHERE product = 'storm_door')::int,
    count(*) FILTER (WHERE product = 'screen')::int,
    count(*) FILTER (WHERE product = 'other')::int,
    count(*)::int
  FROM classified;
$fn$;

COMMENT ON FUNCTION sched_build_install_tally(jsonb) IS
  'Classify one install_docs.doc into unit counts. Mirrors calcConsumableQty + MC_*_ABBREVS in the material-list app. Reads only doc->units, which is stable across INSTALL_DOC_VERSION bumps.';

-- ── 6. Keep the tally in step with install_docs ────────────────────────────
-- SECURITY DEFINER: the writer here is the material-list app holding a
-- configuring role on install_docs, with no permission on sched_install_tally.
-- Same arrangement as sched_publish_day_crews (migration 20261001_002).
--
-- EVERY PATH IS WRAPPED IN AN EXCEPTION HANDLER, and that is the single most
-- important line in this migration.
--
-- install_docs is written by the LIVE material-list app on every submitted job
-- save. An AFTER trigger that raises still aborts the statement, so without
-- this handler a malformed doc, a future shape change, or a bug in the
-- classifier would stop the office from saving jobs. A metrics tab must never
-- be able to do that.
--
-- The cost is that a failure is silent in the app and visible only as a stale
-- or missing tally plus a WARNING in the Postgres log. That is the right trade:
-- a wrong number on a manager's dashboard is recoverable, a blocked job save in
-- production is not. Re-run the backfill (section 9) to repair any row that
-- was skipped.
CREATE OR REPLACE FUNCTION sched_sync_install_tally()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  t RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM sched_install_tally WHERE job_id = OLD.job_id;
    RETURN NULL;
  END IF;

  SELECT * INTO t FROM sched_build_install_tally(NEW.doc);

  INSERT INTO sched_install_tally (
    job_id, order_number,
    windows_if, windows_ff, windows_ej,
    specialty_if, specialty_ff, specialty_ej,
    patio_doors, entry_doors, storm_doors, screens,
    other_units, total_units, doc_version, built_at
  ) VALUES (
    NEW.job_id, NEW.order_number,
    t.windows_if, t.windows_ff, t.windows_ej,
    t.specialty_if, t.specialty_ff, t.specialty_ej,
    t.patio_doors, t.entry_doors, t.storm_doors, t.screens,
    t.other_units, t.total_units, NEW.builder_version, now()
  )
  ON CONFLICT (job_id) DO UPDATE SET
    order_number = EXCLUDED.order_number,
    windows_if   = EXCLUDED.windows_if,
    windows_ff   = EXCLUDED.windows_ff,
    windows_ej   = EXCLUDED.windows_ej,
    specialty_if = EXCLUDED.specialty_if,
    specialty_ff = EXCLUDED.specialty_ff,
    specialty_ej = EXCLUDED.specialty_ej,
    patio_doors  = EXCLUDED.patio_doors,
    entry_doors  = EXCLUDED.entry_doors,
    storm_doors  = EXCLUDED.storm_doors,
    screens      = EXCLUDED.screens,
    other_units  = EXCLUDED.other_units,
    total_units  = EXCLUDED.total_units,
    doc_version  = EXCLUDED.doc_version,
    built_at     = EXCLUDED.built_at;

  RETURN NULL; -- AFTER trigger

EXCEPTION WHEN OTHERS THEN
  -- Never propagate: the material-list app's save must succeed regardless.
  RAISE WARNING 'sched_sync_install_tally failed for job_id=% : %',
    COALESCE(NEW.job_id, OLD.job_id), SQLERRM;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sched_sync_install_tally ON install_docs;
CREATE TRIGGER trg_sched_sync_install_tally
  AFTER INSERT OR DELETE OR UPDATE OF doc, order_number
  ON install_docs
  FOR EACH ROW
  EXECUTE FUNCTION sched_sync_install_tally();

-- ── 7. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE sched_load_weights         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched_utilization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched_crew_targets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched_install_tally        ENABLE ROW LEVEL SECURITY;

-- Read: any scheduling role. The PAGE is gated to manager+admin in the client
-- (canManage), but gating reads here too would break nothing and buys nothing —
-- these are aggregate counts, and the calendar already exposes the appointments
-- they summarize.
DROP POLICY IF EXISTS sched_read_load_weights ON sched_load_weights;
CREATE POLICY sched_read_load_weights ON sched_load_weights FOR SELECT
  USING (public.has_any_role(ARRAY['admin','scheduling','scheduling_manager']));

DROP POLICY IF EXISTS sched_read_utilization_settings ON sched_utilization_settings;
CREATE POLICY sched_read_utilization_settings ON sched_utilization_settings FOR SELECT
  USING (public.has_any_role(ARRAY['admin','scheduling','scheduling_manager']));

DROP POLICY IF EXISTS sched_read_crew_targets ON sched_crew_targets;
CREATE POLICY sched_read_crew_targets ON sched_crew_targets FOR SELECT
  USING (public.has_any_role(ARRAY['admin','scheduling','scheduling_manager']));

DROP POLICY IF EXISTS sched_read_install_tally ON sched_install_tally;
CREATE POLICY sched_read_install_tally ON sched_install_tally FOR SELECT
  USING (public.has_any_role(ARRAY['admin','scheduling','scheduling_manager']));

-- Write: admin only. Phase 2 adds the editors; until then these are SQL edits.
-- sched_install_tally gets NO write policy at all — it is derived data, and the
-- trigger writes it as the table owner, bypassing RLS.
DROP POLICY IF EXISTS sched_admin_write_load_weights ON sched_load_weights;
CREATE POLICY sched_admin_write_load_weights ON sched_load_weights FOR ALL
  USING (public.has_any_role(ARRAY['admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin']));

DROP POLICY IF EXISTS sched_admin_write_utilization_settings ON sched_utilization_settings;
CREATE POLICY sched_admin_write_utilization_settings ON sched_utilization_settings FOR ALL
  USING (public.has_any_role(ARRAY['admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin']));

DROP POLICY IF EXISTS sched_admin_write_crew_targets ON sched_crew_targets;
CREATE POLICY sched_admin_write_crew_targets ON sched_crew_targets FOR ALL
  USING (public.has_any_role(ARRAY['admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin']));

-- ── 8. Data API grants ─────────────────────────────────────────────────────
-- Required for tables created after 2026-10-30 (see 20260923_001). Harmless
-- before then. RLS above is the actual gate; a grant is not access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sched_load_weights         TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sched_utilization_settings TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sched_crew_targets         TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sched_install_tally        TO anon, authenticated, service_role;

-- ── 9. One-time backfill ───────────────────────────────────────────────────
-- The single moment every document IS read. Once, here — not per page load.
-- Re-runnable: recomputes every tally in place, which is also how you rebuild
-- after changing sched_build_install_tally().
INSERT INTO sched_install_tally (
  job_id, order_number,
  windows_if, windows_ff, windows_ej,
  specialty_if, specialty_ff, specialty_ej,
  patio_doors, entry_doors, storm_doors, screens,
  other_units, total_units, doc_version, built_at
)
SELECT
  d.job_id, d.order_number,
  t.windows_if, t.windows_ff, t.windows_ej,
  t.specialty_if, t.specialty_ff, t.specialty_ej,
  t.patio_doors, t.entry_doors, t.storm_doors, t.screens,
  t.other_units, t.total_units, d.builder_version, now()
FROM install_docs d
CROSS JOIN LATERAL sched_build_install_tally(d.doc) t
ON CONFLICT (job_id) DO UPDATE SET
  order_number = EXCLUDED.order_number,
  windows_if   = EXCLUDED.windows_if,
  windows_ff   = EXCLUDED.windows_ff,
  windows_ej   = EXCLUDED.windows_ej,
  specialty_if = EXCLUDED.specialty_if,
  specialty_ff = EXCLUDED.specialty_ff,
  specialty_ej = EXCLUDED.specialty_ej,
  patio_doors  = EXCLUDED.patio_doors,
  entry_doors  = EXCLUDED.entry_doors,
  storm_doors  = EXCLUDED.storm_doors,
  screens      = EXCLUDED.screens,
  other_units  = EXCLUDED.other_units,
  total_units  = EXCLUDED.total_units,
  doc_version  = EXCLUDED.doc_version,
  built_at     = EXCLUDED.built_at;

COMMIT;

-- ── Verify (run separately) ────────────────────────────────────────────────
-- How many documents were tallied, and how big the docs actually are. This
-- also settles whether the trigger was worth it: a large avg_doc means a
-- query-time rollup would have been expensive.
--
--   SELECT count(*) AS docs,
--          pg_size_pretty(pg_total_relation_size('install_docs')) AS install_docs_size,
--          pg_size_pretty(avg(pg_column_size(doc))::bigint)       AS avg_doc,
--          pg_size_pretty(max(pg_column_size(doc))::bigint)       AS max_doc
--     FROM install_docs;
--
--   SELECT count(*) AS tallies,
--          pg_size_pretty(pg_total_relation_size('sched_install_tally')) AS tally_size
--     FROM sched_install_tally;
--
-- Any unrecognized abbrev shows up here. Non-zero means the material-list app
-- grew a product type and sched_build_install_tally needs a new branch:
--
--   SELECT job_id, order_number, other_units, total_units
--     FROM sched_install_tally WHERE other_units > 0 ORDER BY other_units DESC;
--
-- Invariant — every row must sum to total_units (expect zero rows back):
--
--   SELECT job_id FROM sched_install_tally
--    WHERE windows_if + windows_ff + windows_ej
--        + specialty_if + specialty_ff + specialty_ej
--        + patio_doors + entry_doors + storm_doors + screens
--        + other_units <> total_units;

-- ── Rollback (run separately, only if you want this gone) ──────────────────
-- Removes everything this migration added and leaves install_docs exactly as
-- it was. Drop the TRIGGER first if you only want to stop touching the live
-- write path while keeping the data.
--
--   DROP TRIGGER IF EXISTS trg_sched_sync_install_tally ON public.install_docs;
--   DROP FUNCTION IF EXISTS public.sched_sync_install_tally();
--   DROP FUNCTION IF EXISTS public.sched_build_install_tally(jsonb);
--   DROP TABLE IF EXISTS public.sched_install_tally;
--   DROP TABLE IF EXISTS public.sched_crew_targets;
--   DROP TABLE IF EXISTS public.sched_utilization_settings;
--   DROP TABLE IF EXISTS public.sched_load_weights;
