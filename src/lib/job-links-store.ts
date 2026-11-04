/**
 * Reads (and the one write) behind the install-paperwork chips.
 *
 * Every read is narrow and returns null on failure rather than throwing, so a
 * hiccup here can only ever mean "no chips" — never a broken calendar.
 * Kept out of DataProvider on purpose, like utilization-store.
 */

import { getSupabase } from "./supabase";
import { addressKey } from "./address-match";
import type { ActiveWriteUpRef } from "./job-links";

/** Whole table; a few hundred tiny rows. */
export async function fetchLegacyLinkMap(): Promise<Map<string, string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("legacy_install_links").select("order_number, url");
  if (error || !data) return null;
  const map = new Map<string, string>();
  for (const row of data as { order_number: string; url: string }[]) {
    if (row.order_number && row.url) map.set(row.order_number.trim(), row.url);
  }
  return map;
}

/**
 * order_number → install-doc job id, from the precomputed tally (never the fat
 * jobs / install_docs tables). When two rows share an order number the newest
 * build wins, matching how the material-list app treats its own documents.
 */
export async function fetchLinkedJobMap(): Promise<Map<string, string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const PAGE = 1000;
  const newest = new Map<string, { jobId: string; builtAt: string }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("sched_install_tally")
      .select("order_number, job_id, built_at")
      .order("job_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) return null;
    for (const row of data as { order_number: string | null; job_id: string; built_at: string }[]) {
      const key = row.order_number?.trim();
      if (!key) continue;
      const cur = newest.get(key);
      if (!cur || row.built_at > cur.builtAt) newest.set(key, { jobId: row.job_id, builtAt: row.built_at });
    }
    if (data.length < PAGE) break;
  }
  return new Map([...newest].map(([k, v]) => [k, v.jobId]));
}

/**
 * Every active (in_review / open) write-up, grouped by normalized street. Rows
 * whose address has no usable street are dropped — a wrong match would put
 * another customer's issues on this tile.
 */
export async function fetchActiveWriteUpIndex(): Promise<Map<string, ActiveWriteUpRef[]> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("field_work_orders")
    .select("id, order_number, address")
    .in("status", ["in_review", "open"]);
  if (error || !data) return null;
  const index = new Map<string, ActiveWriteUpRef[]>();
  for (const row of data as { id: string; order_number: string | null; address: string | null }[]) {
    const key = addressKey(row.address);
    if (!key.street) continue;
    const list = index.get(key.street) ?? [];
    list.push({ id: row.id, orderNumber: row.order_number || "", zip: key.zip });
    index.set(key.street, list);
  }
  return index;
}

/** Same table, keys and rules as Duck Force (RLS: admin / scheduling / scheduling_manager). */
export async function upsertLegacyLink(orderNumber: string, url: string, updatedBy?: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("legacy_install_links").upsert(
    { order_number: orderNumber, url, updated_by: updatedBy || null, updated_at: new Date().toISOString() },
    { onConflict: "order_number" }
  );
  return !error;
}

export async function deleteLegacyLink(orderNumber: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("legacy_install_links").delete().eq("order_number", orderNumber);
  return !error;
}

/**
 * Change fingerprints — one tiny request per table ("<count>:<newest stamp>").
 *
 * The chips need to stay live while several people schedule at once, so they
 * re-check every minute. A re-check that pulled whole tables would be wasteful;
 * this lets the provider refetch a table only when its fingerprint moved. A
 * delete changes the count, an edit or insert moves the newest stamp. Null on
 * any failure, which the caller treats as "leave what's on screen alone".
 */
export interface JobLinkSignatures {
  legacy: string | null;
  linked: string | null;
  writeUps: string | null;
}

async function signature(
  table: string,
  stampColumn: string,
  activeOnly = false
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  let q = sb
    .from(table)
    .select(stampColumn, { count: "exact" })
    .order(stampColumn, { ascending: false })
    .limit(1);
  if (activeOnly) q = q.in("status", ["in_review", "open"]);
  const { data, error, count } = await q;
  if (error || count == null) return null;
  const newest = (data as unknown as Record<string, string>[] | null)?.[0]?.[stampColumn] ?? "";
  return `${count}:${newest}`;
}

export async function fetchJobLinkSignatures(): Promise<JobLinkSignatures> {
  const [legacy, linked, writeUps] = await Promise.all([
    signature("legacy_install_links", "updated_at").catch(() => null),
    signature("sched_install_tally", "built_at").catch(() => null),
    signature("field_work_orders", "updated_at", true).catch(() => null),
  ]);
  return { legacy, linked, writeUps };
}
