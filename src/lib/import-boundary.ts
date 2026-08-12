/**
 * Import Boundary — the single entry point for rForce CSV data.
 *
 * Guarantees:
 *  1. Idempotent: SHA-256 content hash detects duplicate imports.
 *  2. Auditable: every import creates a sched_csv_imports record.
 *  3. Change-tracked: per-order snapshots record what changed.
 *  4. Non-destructive: upserts to work_orders; never deletes rows.
 *
 * Data flows:
 *  - Manual CSV upload → importCsv(csvText, "manual_upload", user)
 *  - Power Automate    → writes work_orders directly (bypass)
 *  - Both are visible in fetchRForceOrders()
 */

import { requireSupabase } from "./supabase";
import { parseCsv } from "./parse-csv";
import type { CsvImport, RForceOrder } from "./types";

// ── Content hashing ──

async function sha256(text: string): Promise<string> {
  // Works in both browser (Web Crypto) and Node (globalThis.crypto)
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Import result ──

export interface ImportResult {
  importId: string;
  status: "success" | "duplicate" | "empty" | "parse_error";
  /** Number of WO rows parsed from CSV */
  orderCount: number;
  /** Number of rows that had data changes vs. prior state */
  changedCount: number;
  /** Number of rows that are net-new (didn't exist before) */
  newCount: number;
  /** Human message for UI display */
  message: string;
}

// ── Duplicate check ──

async function findExistingImport(hash: string): Promise<CsvImport | null> {
  const sb = requireSupabase();
  const { data } = await sb
    .from("sched_csv_imports")
    .select("*")
    .eq("content_hash", hash)
    .limit(1)
    .maybeSingle();
  return (data as CsvImport) ?? null;
}

// ── Snapshot diff ──

/** Compare two order records and return a field-level change summary */
function diffOrder(
  oldRow: Record<string, unknown>,
  newOrder: Omit<RForceOrder, "updated_at">
): Record<string, { old: unknown; new: unknown }> | null {
  // Fields worth tracking for change detection
  const TRACKED_FIELDS = [
    "customer_name", "address", "order_status", "wo_status",
    "work_order_type", "scheduled_start", "scheduled_end",
    "primary_resource", "tech_measure_name", "installer", "service_rep",
    "product_count", "windows", "patio_doors", "doors",
    "order_alerts", "account_name",
  ] as const;

  // Map DB column names to RForceOrder field names where they differ
  const DB_TO_RF: Record<string, string> = {
    status: "order_status",
    appointment_status: "wo_status",
    tech_measure: "tech_measure_name",
  };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of TRACKED_FIELDS) {
    // The DB might use a different column name than the RForceOrder type
    const dbField = Object.entries(DB_TO_RF).find(([, rf]) => rf === field)?.[0] ?? field;
    const oldVal = oldRow[dbField] ?? null;
    const newVal = (newOrder as Record<string, unknown>)[field] ?? null;
    if (String(oldVal ?? "") !== String(newVal ?? "")) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// ── Core import function ──

/**
 * Import CSV text into the work_orders table.
 *
 * 1. Parses CSV
 * 2. Hashes content to check for duplicates
 * 3. Creates a sched_csv_imports audit record
 * 4. Upserts each parsed order into work_orders
 * 5. Creates sched_import_snapshots for changed/new orders
 * 6. Updates the import record with final counts
 */
export async function importCsv(
  csvText: string,
  source: "power_automate" | "manual_upload" = "manual_upload",
  importedBy?: string
): Promise<ImportResult> {
  // 1. Parse
  const orders = parseCsv(csvText);
  if (orders.length === 0) {
    return {
      importId: "",
      status: "parse_error",
      orderCount: 0,
      changedCount: 0,
      newCount: 0,
      message: "CSV contained no valid work orders. Check format and headers.",
    };
  }

  // 2. Hash for idempotency
  const contentHash = await sha256(csvText);
  const existing = await findExistingImport(contentHash);
  if (existing) {
    return {
      importId: existing.id,
      status: "duplicate",
      orderCount: existing.order_count ?? orders.length,
      changedCount: 0,
      newCount: 0,
      message: `This file was already imported on ${new Date(existing.imported_at).toLocaleDateString()}. No changes made.`,
    };
  }

  const sb = requireSupabase();

  // 3. Create import audit record
  const { data: importRecord, error: importErr } = await sb
    .from("sched_csv_imports")
    .insert({
      filename: null, // Caller can update if they have a filename
      row_count: orders.length,
      source,
      imported_by: importedBy ?? null,
      content_hash: contentHash,
      order_count: orders.length,
      changed_count: 0, // Updated after processing
      new_count: 0,     // Updated after processing
    })
    .select()
    .single();

  if (importErr || !importRecord) {
    throw new Error(`Failed to create import record: ${importErr?.message ?? "no data returned"}`);
  }

  const importId = (importRecord as CsvImport).id;
  let changedCount = 0;
  let newCount = 0;

  // 4. Process each order: fetch existing → diff → upsert → snapshot
  for (const order of orders) {
    const woNum = order.work_order_number;

    // Fetch current state (if exists) for diff
    const { data: existingRows } = await sb
      .from("work_orders")
      .select("*")
      .eq("work_order_number", woNum)
      .limit(1);

    const existingRow = existingRows && existingRows.length > 0
      ? (existingRows[0] as Record<string, unknown>)
      : null;

    // Build the upsert payload matching the DB schema
    const upsertPayload = {
      work_order_number: order.work_order_number,
      order_number: order.order_number,
      status: order.order_status,
      appointment_status: order.wo_status,
      work_order_type: order.work_order_type,
      customer_name: order.customer_name,
      address: order.address,
      scheduled_start: order.scheduled_start,
      scheduled_end: order.scheduled_end,
      product_count: order.product_count,
      windows: order.windows,
      patio_doors: order.patio_doors,
      doors: order.doors,
      primary_resource: order.primary_resource,
      tech_measure: order.tech_measure_name,
      installer: order.installer,
      service_rep: order.service_rep,
      order_alerts: order.order_alerts,
      account_name: order.account_name,
      updated_at: new Date().toISOString(),
    };

    // Diff before upsert
    const changeSummary = existingRow ? diffOrder(existingRow, order) : null;
    const isNew = !existingRow;

    // Upsert into work_orders
    const { error: upsertErr } = await sb
      .from("work_orders")
      .upsert(upsertPayload, { onConflict: "work_order_number" });

    if (upsertErr) {
      console.warn(`[import] Failed to upsert WO ${woNum}:`, upsertErr.message);
      continue;
    }

    // Create snapshot if new or changed
    if (isNew || changeSummary) {
      if (isNew) newCount++;
      if (changeSummary) changedCount++;

      const snapshot: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(order)) {
        snapshot[k] = v;
      }

      await sb
        .from("sched_import_snapshots")
        .insert({
          import_id: importId,
          work_order_number: woNum,
          snapshot,
          change_summary: changeSummary,
        })
        .then(({ error }) => {
          if (error) console.warn(`[import] Snapshot for ${woNum} failed:`, error.message);
        });
    }
  }

  // 5. Update import record with final counts
  await sb
    .from("sched_csv_imports")
    .update({ changed_count: changedCount, new_count: newCount })
    .eq("id", importId);

  return {
    importId,
    status: "success",
    orderCount: orders.length,
    changedCount,
    newCount,
    message: `Imported ${orders.length} work orders: ${newCount} new, ${changedCount} updated, ${orders.length - newCount - changedCount} unchanged.`,
  };
}

// ── Import history ──

export async function fetchCsvImports(): Promise<CsvImport[]> {
  const sb = requireSupabase();
  const { data } = await sb
    .from("sched_csv_imports")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(50);
  return (data as CsvImport[]) ?? [];
}
