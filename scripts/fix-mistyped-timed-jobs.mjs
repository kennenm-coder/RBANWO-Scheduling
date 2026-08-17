/**
 * One-time cleanup: appointments for TIMED rForce jobs (Service / JIP / HOA /
 * Paint) that were stamped as a blocked slot (time_block = 'full_day' or a
 * measure block) — often also mis-typed as "install" (e.g. a noon Job Site
 * Visit stored as a full-day install). A full_day appointment blocks the crew's
 * WHOLE day in the conflict guard, so these silently cause false double-bookings.
 *
 * For each such appointment we set:
 *   - appointment_type = the type derived from the linked rForce work_order_type
 *   - time_block       = null   (timed — no full-day block)
 *   - start_time/end_time = the real rForce window
 *
 * Genuine installs and measures are left untouched (only timed WO types match).
 *
 * Usage:
 *   node scripts/fix-mistyped-timed-jobs.mjs .env.local            # DRY RUN
 *   node scripts/fix-mistyped-timed-jobs.mjs .env.local --apply    # WRITE
 */
import { readFileSync, writeFileSync } from "node:fs";

const envPath = process.argv[2] || ".env.local";
const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Missing Supabase URL/anon key"); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

// ── WO type → canonical appointment type (mirror of src/lib/normalize.ts) ──
const RAW_WO_TYPE = {
  "tech measure": "tech_measure", "install": "install", "service": "service",
  "jip": "jip", "job site visit": "jip", "job site visit/jip": "jip",
  "lswp": "lswp", "hoa": "hoa", "paint/stain": "paint_stain", "paint": "paint_stain",
  "paint shop": "paint_stain", "stain": "paint_stain",
};
function normalizeWoType(raw) {
  if (!raw) return null;
  return RAW_WO_TYPE[raw.trim().toLowerCase()] ?? null;
}
const TYPE_MODE = {
  tech_measure: "fixed_block", install: "full_day", service: "timed",
  jip: "timed", lswp: "full_day", hoa: "timed", paint_stain: "timed",
};
function wallClock(iso) { return iso && iso.length >= 16 ? iso.slice(11, 16) : null; }
// timed derivation only (this script only touches timed WO types)
function deriveTimed(scheduledStart, scheduledEnd) {
  const rs = wallClock(scheduledStart);
  if (!rs || rs === "00:00") return null;
  const startDate = scheduledStart.slice(0, 10);
  const endDate = scheduledEnd ? scheduledEnd.slice(0, 10) : startDate;
  if (startDate !== endDate) return null; // multi-day timed → leave alone
  const re = wallClock(scheduledEnd);
  if (!re || rs >= re) return null;
  return { start_time: rs, end_time: re, time_block: null };
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

async function loadAll(path) {
  const out = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const r = await rest(path, { headers: { Range: `${from}-${from + pageSize - 1}` } });
    if (!r.ok) { console.error("Load failed", r.status, r.body); process.exit(1); }
    out.push(...r.body);
    if (r.body.length < pageSize) break;
  }
  return out;
}

console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

// Only appointments that are currently BLOCKED (time_block not null) can be the
// mis-flagged ones; a job already timed (null block) is fine.
const appts = await loadAll(
  "sched_appointments?select=id,customer_name,appointment_type,scheduled_date,time_block,start_time,end_time,version,work_order_number&status=not.in.(cancelled,unscheduled)&work_order_number=not.is.null&time_block=not.is.null&order=scheduled_date"
);
console.log(`Loaded ${appts.length} active, blocked, linked appointments.`);

const woNums = [...new Set(appts.map((a) => (a.work_order_number || "").trim().toLowerCase()).filter(Boolean))];
const woMap = new Map();
for (let i = 0; i < woNums.length; i += 40) {
  const inList = woNums.slice(i, i + 40).map((w) => `"${w}"`).join(",");
  const r = await rest(`work_orders?select=work_order_number,work_order_type,scheduled_start,scheduled_end&work_order_number=in.(${inList})`);
  if (Array.isArray(r.body)) for (const w of r.body) woMap.set((w.work_order_number || "").trim().toLowerCase(), w);
}
console.log(`Loaded ${woMap.size} linked work orders.\n`);

const plan = [];
const skips = { noWo: 0, notTimed: 0, noDerive: 0 };
const typeChanges = {};

for (const a of appts) {
  const wo = woMap.get((a.work_order_number || "").trim().toLowerCase());
  if (!wo || !wo.scheduled_start) { skips.noWo++; continue; }
  const correctType = normalizeWoType(wo.work_order_type);
  if (!correctType || TYPE_MODE[correctType] !== "timed") { skips.notTimed++; continue; }
  const d = deriveTimed(wo.scheduled_start, wo.scheduled_end);
  if (!d) { skips.noDerive++; continue; }

  const typeChange = a.appointment_type !== correctType;
  if (typeChange) typeChanges[`${a.appointment_type}→${correctType}`] = (typeChanges[`${a.appointment_type}→${correctType}`] || 0) + 1;

  plan.push({
    id: a.id, version: a.version, customer: a.customer_name,
    date: a.scheduled_date,
    from: `${a.appointment_type} ${hhmm(a.start_time)}-${hhmm(a.end_time)} [${a.time_block}]`,
    to: `${correctType} ${d.start_time}-${d.end_time} [timed]`,
    appointment_type: correctType, start_time: d.start_time, end_time: d.end_time,
    orig_type: a.appointment_type, orig_start: a.start_time, orig_end: a.end_time, orig_block: a.time_block,
  });
}

console.log("── Plan summary ──");
console.log(`  Timed jobs to un-block: ${plan.length}`);
console.log(`  Type corrections:`, typeChanges);
console.log(`  Skipped — not a timed WO type (install/measure): ${skips.notTimed}`);
console.log(`  Skipped — no linked WO time: ${skips.noWo}`);
console.log(`  Skipped — no usable time (bogus/multi-day): ${skips.noDerive}\n`);

console.log("── Sample changes (first 40) ──");
for (const p of plan.slice(0, 40)) {
  console.log(`  ${(p.customer || "").slice(0, 22).padEnd(22)} ${p.date}  ${p.from.padEnd(34)} -> ${p.to}`);
}

writeFileSync("fix_mistyped_plan.json", JSON.stringify(plan, null, 2));
console.log(`\nFull plan written to fix_mistyped_plan.json`);

if (!APPLY) { console.log("\nDRY RUN complete. Re-run with --apply to write these changes."); process.exit(0); }

const rollback = plan.map((p) => ({ id: p.id, appointment_type: p.orig_type, start_time: p.orig_start, end_time: p.orig_end, time_block: p.orig_block }));
writeFileSync("fix_mistyped_rollback.json", JSON.stringify(rollback, null, 2));
console.log(`Rollback snapshot written to fix_mistyped_rollback.json`);
console.log("\nApplying updates...");
let ok = 0; const failures = [];
for (const p of plan) {
  const r = await rest(`sched_appointments?id=eq.${p.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      appointment_type: p.appointment_type, time_block: null,
      start_time: p.start_time, end_time: p.end_time,
      version: p.version + 1, updated_at: new Date().toISOString(),
    }),
  });
  if (r.ok) ok++;
  else failures.push({ id: p.id, customer: p.customer, status: r.status, body: r.body });
}
console.log(`\nDone. Updated ${ok}/${plan.length}.`);
if (failures.length) {
  console.log(`Failures (${failures.length}):`);
  for (const f of failures.slice(0, 25)) console.log(`  ${f.customer} (${f.id}) — ${f.status} ${JSON.stringify(f.body).slice(0, 160)}`);
  writeFileSync("fix_mistyped_failures.json", JSON.stringify(failures, null, 2));
}
