/**
 * One-time backfill: turn COMPLETED rForce work orders into calendar tiles.
 *
 * The scheduling queue's "Confirm" bucket is flooded with jobs whose rForce
 * status is "Appt Complete / Closed" — finished work that was never entered into
 * the app, so it has no tile and keeps showing as "needs confirmation". Rather
 * than hide them, this backfills each as a calendar tile on its real date/crew,
 * marked status = "complete", so the calendar becomes a full historical record
 * and the queue clears.
 *
 * It mirrors the app's own approve path (src/lib/store.ts approveRForceOrder):
 *   - resource name → crew   via matchCrewByName (+ resource_mappings)
 *   - real times/block/dur   via deriveTimesFromOrder
 *   - direct insert with allow_overlap = true (history can legitimately overlap;
 *     bypasses the double-booking guard, same as the app's override path)
 *
 * Selection (matches what the queue actually shows):
 *   - appointment_status = "Appt Complete / Closed"
 *   - scheduled_start present and >= cutoff (default 90 days, like fetchRForceOrders)
 *   - no existing ACTIVE (non-cancelled) appointment for that work order
 *   - resource resolves to a known crew (unresolved are skipped + reported)
 *
 * Usage:
 *   node scripts/backfill-completed-tiles.mjs .env.local                 # DRY RUN
 *   node scripts/backfill-completed-tiles.mjs .env.local --apply         # WRITE
 *   node scripts/backfill-completed-tiles.mjs .env.local --days=365      # wider window
 *   node scripts/backfill-completed-tiles.mjs .env.local --all           # all history
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── args / env ──
const envPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".env.local";
const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? parseInt(daysArg.split("=")[1], 10) : 90;

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Missing Supabase URL/key in", envPath); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const COMPLETED_STATUS = "Appt Complete / Closed";
const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - DAYS);
const cutoffISO = cutoff.toISOString();

// ── ported app logic (kept byte-for-byte with src/lib) ──
const RAW_WO_TYPE = {
  "tech measure": "tech_measure", "install": "install", "service": "service",
  "jip": "jip", "job site visit": "jip", "job site visit\\jip": "jip",
  "lswp": "lswp", "hoa": "hoa", "paint\\stain": "paint_stain", "paint": "paint_stain",
  "paint shop": "paint_stain", "stain": "paint_stain",
};
const normalizeWoType = (raw) => (raw ? RAW_WO_TYPE[raw.trim().toLowerCase()] ?? null : null);
const TYPE_MODE = {
  tech_measure: "fixed_block", install: "full_day", service: "timed",
  jip: "timed", lswp: "full_day", hoa: "timed", paint_stain: "timed",
};
const getSchedulingMode = (t) => TYPE_MODE[t] ?? "timed";
const timeToBlock = (h) => (h < 10 ? "9-10" : h < 12 ? "10-12" : h < 14 ? "12-2" : h < 16 ? "2-4" : "4-6");
const wall = (iso) => (!iso || iso.length < 16 ? null : iso.slice(11, 16));

function deriveTimes(scheduledStart, scheduledEnd, type) {
  const rs = wall(scheduledStart);
  if (!rs || rs === "00:00") return null;
  const startDate = scheduledStart.slice(0, 10);
  const endDate = scheduledEnd ? scheduledEnd.slice(0, 10) : startDate;
  const sameDay = startDate === endDate;
  const mode = getSchedulingMode(type);
  if (!sameDay) return mode === "full_day" ? { start_time: "08:00", end_time: "16:00", time_block: "full_day" } : null;
  const re = wall(scheduledEnd);
  if (!re || rs >= re) return null;
  let time_block;
  if (mode === "fixed_block") { const h = parseInt(rs.slice(0, 2), 10); time_block = Number.isNaN(h) ? null : timeToBlock(h); }
  else if (mode === "full_day") time_block = "full_day";
  else time_block = null;
  return { start_time: rs, end_time: re, time_block };
}

function matchCrew(resourceName, crews, mappings) {
  if (!resourceName) return undefined;
  const lower = resourceName.toLowerCase().trim();
  const mapping = mappings.find((m) => (m.raw_name || "").toLowerCase() === lower);
  if (mapping) { const c = crews.find((c) => c.id === mapping.crew_id); if (c) return c; }
  const exact = crews.find((c) => (c.name || "").toLowerCase() === lower);
  if (exact) return exact;
  const alias = crews.find((c) => (c.aliases || []).some((a) => (a || "").toLowerCase() === lower));
  if (alias) return alias;
  const first = lower.split(" ")[0];
  return crews.find((c) => (c.name || "").toLowerCase().split(" ")[0] === first);
}

const salesforceUrl = (wo) => `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${encodeURIComponent(wo)}`;
const norm = (s) => (s || "").trim().toLowerCase();

// ── paged fetch helper ──
async function pageAll(table, select, applyFilters) {
  const out = []; let from = 0; const BATCH = 1000;
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + BATCH - 1);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) { console.error(`fetch ${table}:`, error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return out;
}

async function main() {
  console.log(`\nBackfill completed rForce jobs → calendar tiles`);
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
  console.log(`Window: ${ALL ? "ALL history" : `scheduled_start >= ${cutoffISO.slice(0, 10)} (${DAYS} days)`}\n`);

  const crews = await pageAll("sched_crews", "id,name,aliases,crew_type", (q) => q);
  const mappings = await pageAll("sched_resource_mappings", "raw_name,crew_id", (q) => q);
  const activeAppts = await pageAll(
    "sched_appointments", "work_order_number,status",
    (q) => q.neq("status", "cancelled").neq("status", "unscheduled")
  );
  const tiled = new Set(activeAppts.map((a) => norm(a.work_order_number)).filter(Boolean));

  const orders = await pageAll(
    "work_orders",
    "id,work_order_number,order_number,customer_name,address,work_order_type,scheduled_start,scheduled_end,product_count,appointment_status,status,primary_resource,tech_measure,installer,service_rep",
    (q) => {
      let x = q.eq("appointment_status", COMPLETED_STATUS).not("scheduled_start", "is", null).neq("work_order_number", "");
      if (!ALL) x = x.gte("scheduled_start", cutoffISO);
      return x;
    }
  );

  const rows = [];
  const skip = { alreadyTiled: 0, noCrew: 0, noType: 0 };
  const noCrewSamples = new Set();
  let fallbackTimes = 0;

  for (const o of orders) {
    const woTrim = (o.work_order_number || "").trim();
    if (!woTrim) continue;
    if (tiled.has(norm(woTrim))) { skip.alreadyTiled++; continue; }

    const type = normalizeWoType(o.work_order_type) || "install";
    const resourceName = o.primary_resource || o.tech_measure || o.installer || o.service_rep || "";
    const crew = matchCrew(resourceName, crews, mappings);
    if (!crew) { skip.noCrew++; if (noCrewSamples.size < 12) noCrewSamples.add(resourceName || "(blank)"); continue; }

    let derived = deriveTimes(o.scheduled_start, o.scheduled_end, type);
    if (!derived) { fallbackTimes++; derived = { start_time: "08:00", end_time: "16:00", time_block: getSchedulingMode(type) === "timed" ? null : "full_day" }; }

    // duration from date span (matches approveRForceOrder)
    let durationDays = 1;
    if (o.scheduled_start && o.scheduled_end) {
      const sd = o.scheduled_start.slice(0, 10), ed = o.scheduled_end.slice(0, 10);
      if (sd !== ed) { const d = Math.round((new Date(ed) - new Date(sd)) / 86400000) + 1; if (d > 1 && d <= 14) durationDays = d; }
    }

    rows.push({
      crew_id: crew.id,
      appointment_type: type,
      order_number: o.order_number || null,
      work_order_number: woTrim,
      customer_name: o.customer_name || "Unknown",
      address: o.address || "",
      scheduled_date: o.scheduled_start.slice(0, 10),
      start_time: derived.start_time,
      end_time: derived.end_time,
      duration_days: durationDays,
      time_block: derived.time_block,
      status: "complete",
      product_count: o.product_count ?? null,
      salesforce_url: salesforceUrl(woTrim),
      scheduled_by: null,
      origin: "rforce_approved",
      sync_state: "in_sync",
      allow_overlap: true,
    });
  }

  console.log(`Completed orders in window:     ${orders.length}`);
  console.log(`  → already have a tile:        ${skip.alreadyTiled}`);
  console.log(`  → no crew match (skipped):    ${skip.noCrew}`);
  console.log(`  → will backfill as tiles:     ${rows.length}`);
  console.log(`     (of those, times defaulted: ${fallbackTimes})`);
  if (noCrewSamples.size) console.log(`  unmatched resource samples:   ${[...noCrewSamples].join(" | ")}`);

  // type breakdown
  const byType = {};
  for (const r of rows) byType[r.appointment_type] = (byType[r.appointment_type] || 0) + 1;
  console.log(`  by type:`, byType);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to create these ${rows.length} tiles.`);
    return;
  }

  console.log(`\nWriting ${rows.length} tiles in batches…`);
  const created = [];
  const failed = [];
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await sb.from("sched_appointments").insert(chunk).select("id");
    if (!error) {
      created.push(...data.map((d) => d.id));
    } else {
      // Batch failed (atomic) — retry each row so one bad row can't sink the batch.
      for (const row of chunk) {
        const { data: one, error: e1 } = await sb.from("sched_appointments").insert(row).select("id").single();
        if (e1) failed.push({ wo: row.work_order_number, error: e1.message });
        else created.push(one.id);
      }
    }
    process.stdout.write(`  ${created.length + failed.length}/${rows.length}\r`);
  }
  console.log(`\nDone. Created ${created.length} tiles. Failed ${failed.length}.`);
  if (failed.length) {
    const shown = failed.slice(0, 8);
    for (const f of shown) console.log(`  FAIL WO ${f.wo}: ${f.error}`);
    if (failed.length > shown.length) console.log(`  …and ${failed.length - shown.length} more`);
  }

  const rollbackPath = `backfill_completed_rollback_${Date.now()}.json`;
  writeFileSync(rollbackPath, JSON.stringify({ created_ids: created, when: new Date().toISOString() }, null, 2));
  console.log(`Rollback ids written to ${rollbackPath}`);
  console.log(`To undo: delete sched_appointments where id in (those ids).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
