/**
 * One-time backfill: repair sched_appointments whose start_time / end_time /
 * time_block were stamped from a time-block default (e.g. full_day → 08:00–16:00)
 * instead of the linked rForce order's real scheduled window.
 *
 * The derivation MIRRORS src/lib/rforce-times.ts (deriveTimesFromOrder) so the
 * historical repair matches what the live write paths will produce going forward.
 *
 * Usage:
 *   node scripts/backfill-appointment-times.mjs .env.local            # DRY RUN
 *   node scripts/backfill-appointment-times.mjs .env.local --apply    # WRITE
 *
 * Reads Supabase URL + anon key from the given env file (same creds the app uses
 * client-side; RLS permits these updates).
 */
import { readFileSync, writeFileSync } from "node:fs";

const envPath = process.argv[2] || ".env.local";
const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
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

// ── Derivation (mirror of src/lib/rforce-times.ts) ──
const TYPE_MODE = {
  tech_measure: "fixed_block", install: "full_day", service: "timed",
  jip: "timed", lswp: "full_day", hoa: "timed", paint_stain: "timed",
};
function timeToBlock(hour) {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}
function wallClock(iso) { return iso && iso.length >= 16 ? iso.slice(11, 16) : null; }
function deriveTimesFromOrder(scheduledStart, scheduledEnd, type) {
  const rs = wallClock(scheduledStart);
  if (!rs || rs === "00:00") return null;
  const startDate = scheduledStart.slice(0, 10);
  const endDate = scheduledEnd ? scheduledEnd.slice(0, 10) : startDate;
  const sameDay = startDate === endDate;
  const mode = TYPE_MODE[type] ?? "timed";
  if (!sameDay) {
    if (mode === "full_day") return { start_time: "08:00", end_time: "16:00", time_block: "full_day" };
    return null;
  }
  const re = wallClock(scheduledEnd);
  if (!re || rs >= re) return null;
  let time_block;
  if (mode === "fixed_block") { const h = parseInt(rs.slice(0, 2), 10); time_block = Number.isNaN(h) ? null : timeToBlock(h); }
  else if (mode === "full_day") time_block = "full_day";
  else time_block = null;
  return { start_time: rs, end_time: re, time_block };
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// ── Load data ──
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

const appts = await loadAll(
  "sched_appointments?select=id,customer_name,appointment_type,crew_id,scheduled_date,time_block,start_time,end_time,version,work_order_number,allow_overlap&status=not.in.(cancelled,unscheduled)&work_order_number=not.is.null&order=scheduled_date"
);
console.log(`Loaded ${appts.length} active linked appointments.`);

const woNums = [...new Set(appts.map((a) => (a.work_order_number || "").trim().toLowerCase()).filter(Boolean))];
const woMap = new Map();
for (let i = 0; i < woNums.length; i += 40) {
  const inList = woNums.slice(i, i + 40).map((w) => `"${w}"`).join(",");
  const r = await rest(`work_orders?select=work_order_number,scheduled_start,scheduled_end&work_order_number=in.(${inList})`);
  if (Array.isArray(r.body)) for (const w of r.body) woMap.set((w.work_order_number || "").trim().toLowerCase(), w);
}
console.log(`Loaded ${woMap.size} linked work orders.\n`);

// Reserved (crew_id|date|block) slots from rows we are NOT changing the block of,
// so a block change can't collide with the unique index idx_no_double_book.
const occupied = new Map(); // key -> count of active, non-overlap rows
const keyOf = (crew, date, block) => `${crew}|${date}|${block}`;
for (const a of appts) {
  if (a.allow_overlap) continue;
  if (!a.crew_id || !a.scheduled_date || !a.time_block) continue;
  const k = keyOf(a.crew_id, a.scheduled_date, a.time_block);
  occupied.set(k, (occupied.get(k) || 0) + 1);
}

const plan = [];
const skips = { noWo: 0, noDerive: 0, alreadyCorrect: 0, blockCollision: 0 };
const byType = {};

for (const a of appts) {
  const wo = woMap.get((a.work_order_number || "").trim().toLowerCase());
  if (!wo || !wo.scheduled_start) { skips.noWo++; continue; }
  const d = deriveTimesFromOrder(wo.scheduled_start, wo.scheduled_end, a.appointment_type);
  if (!d) { skips.noDerive++; continue; }

  const curStart = hhmm(a.start_time), curEnd = hhmm(a.end_time), curBlock = a.time_block ?? null;
  let targetBlock = d.time_block;

  // Guard the unique index: if changing block into a slot another active row
  // already holds, keep the current block (still fix the times).
  let blockKept = false;
  if (targetBlock !== curBlock && targetBlock != null && !a.allow_overlap && a.crew_id && a.scheduled_date) {
    const k = keyOf(a.crew_id, a.scheduled_date, targetBlock);
    // free my own current slot first
    const selfKey = curBlock ? keyOf(a.crew_id, a.scheduled_date, curBlock) : null;
    const existing = (occupied.get(k) || 0) - (selfKey === k ? 1 : 0);
    if (existing > 0) { targetBlock = curBlock; blockKept = true; skips.blockCollision++; }
  }

  const changed = curStart !== d.start_time || curEnd !== d.end_time || (curBlock ?? null) !== (targetBlock ?? null);
  if (!changed) { skips.alreadyCorrect++; continue; }

  // update reservation maps for subsequent collision checks
  if (!a.allow_overlap && a.crew_id && a.scheduled_date) {
    if (curBlock) { const sk = keyOf(a.crew_id, a.scheduled_date, curBlock); occupied.set(sk, Math.max(0, (occupied.get(sk) || 0) - 1)); }
    if (targetBlock) { const tk = keyOf(a.crew_id, a.scheduled_date, targetBlock); occupied.set(tk, (occupied.get(tk) || 0) + 1); }
  }

  byType[a.appointment_type] = (byType[a.appointment_type] || 0) + 1;
  plan.push({
    id: a.id, version: a.version, customer: a.customer_name, type: a.appointment_type,
    date: a.scheduled_date,
    from: `${curStart}-${curEnd} [${curBlock}]`,
    to: `${d.start_time}-${d.end_time} [${targetBlock}]${blockKept ? " (block kept: collision)" : ""}`,
    start_time: d.start_time, end_time: d.end_time, time_block: targetBlock,
    // structured originals for rollback
    orig_start_time: a.start_time, orig_end_time: a.end_time, orig_time_block: curBlock,
  });
}

console.log("── Plan summary ──");
console.log(`  Rows to update: ${plan.length}`);
console.log(`  By type:`, byType);
console.log(`  Skipped — already correct: ${skips.alreadyCorrect}`);
console.log(`  Skipped — no linked WO time: ${skips.noWo}`);
console.log(`  Skipped — no usable derive (bogus/multi-day non-fullday): ${skips.noDerive}`);
console.log(`  Block change suppressed (collision, times still fixed): ${skips.blockCollision}\n`);

console.log("── Sample changes (first 30) ──");
for (const p of plan.slice(0, 30)) {
  console.log(`  ${p.type.padEnd(12)} ${(p.customer || "").slice(0, 20).padEnd(20)} ${p.date}  ${p.from.padEnd(24)} -> ${p.to}`);
}

const outFile = envPath.replace(/[^a-z0-9]/gi, "_") + "_backfill_plan.json";
writeFileSync(outFile, JSON.stringify(plan, null, 2));
console.log(`\nFull plan written to ${outFile}`);

if (!APPLY) { console.log("\nDRY RUN complete. Re-run with --apply to write these changes."); process.exit(0); }

// ── Apply ──
// Write a rollback file first so the change is reversible.
const rollback = plan.map((p) => ({
  id: p.id, start_time: p.orig_start_time, end_time: p.orig_end_time, time_block: p.orig_time_block,
}));
const rollbackFile = "backfill_rollback.json";
writeFileSync(rollbackFile, JSON.stringify(rollback, null, 2));
console.log(`Rollback snapshot written to ${rollbackFile}`);
console.log("\nApplying updates...");
let ok = 0; const failures = [];
for (const p of plan) {
  const r = await rest(`sched_appointments?id=eq.${p.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      start_time: p.start_time, end_time: p.end_time, time_block: p.time_block,
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
  writeFileSync("backfill_failures.json", JSON.stringify(failures, null, 2));
}
