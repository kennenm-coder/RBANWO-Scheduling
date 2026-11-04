/**
 * Install-paperwork status for a scheduled tile, mirroring the Duck Force
 * calendar's JobCard. Pure — no I/O — so the rules are testable on their own.
 *
 *   • "Mat List" — a material list is attached to the order (row in
 *     sched_install_tally, which a trigger fills per saved install doc).
 *   • "Legacy"   — an old Drive link exists in legacy_install_links. Only
 *     meaningful when there is no material list; the material list wins.
 *   • Write-ups  — active field write-ups at the job's ADDRESS. Service tiles
 *     only: a service job has its own order number, the issues were filed
 *     against the original install.
 *
 * Only `install` tiles get the first two; only `service` tiles get the third.
 * Measures and the other types are never touched.
 */

import type { Appointment, AppointmentType } from "./types";
import { addressKey } from "./address-match";

/** Duck Force (the calendar app) — where install docs and write-ups open. */
export const DUCK_FORCE_URL = "https://betterthengooglecal-5taw.vercel.app";

export const INSTALL_LINK_TYPES: ReadonlyArray<AppointmentType> = ["install"];
export const WRITEUP_TYPES: ReadonlyArray<AppointmentType> = ["service"];

export interface ActiveWriteUpRef {
  id: string;
  orderNumber: string;
  zip: string;
}

export interface JobLinkData {
  /** order_number → legacy Drive URL */
  legacy: Map<string, string>;
  /** order_number → install doc job id (Duck Force /install/<id>) */
  linked: Map<string, string>;
  /** normalized street → active write-ups */
  writeUps: Map<string, ActiveWriteUpRef[]>;
}

export const EMPTY_JOB_LINKS: JobLinkData = {
  legacy: new Map(),
  linked: new Map(),
  writeUps: new Map(),
};

export interface JobLinkState {
  /** Duck Force install-doc page, when a material list is attached. */
  installDocUrl: string | null;
  /** Legacy URL — null whenever a material list exists (it overrides). */
  legacyUrl: string | null;
  /** Active write-ups at this address (service tiles). */
  writeUpCount: number;
  /** Distinct order numbers those write-ups were filed under. */
  writeUpOrders: number;
  writeUpUrl: string | null;
}

export const NO_JOB_LINKS: JobLinkState = {
  installDocUrl: null,
  legacyUrl: null,
  writeUpCount: 0,
  writeUpOrders: 0,
  writeUpUrl: null,
};

export function installDocHref(jobId: string): string {
  return `${DUCK_FORCE_URL}/install/${encodeURIComponent(jobId)}`;
}

export function writeUpsHref(address: string): string {
  return `${DUCK_FORCE_URL}/work-orders/address/${encodeURIComponent(address)}`;
}

export function resolveJobLinks(
  appt: Pick<Appointment, "appointment_type" | "order_number" | "address">,
  data: JobLinkData,
  canSeeWriteUps: boolean
): JobLinkState {
  if (INSTALL_LINK_TYPES.includes(appt.appointment_type)) {
    const order = (appt.order_number || "").trim();
    if (!order) return NO_JOB_LINKS;
    const jobId = data.linked.get(order);
    if (jobId) {
      return { ...NO_JOB_LINKS, installDocUrl: installDocHref(jobId) };
    }
    const legacy = data.legacy.get(order);
    return legacy ? { ...NO_JOB_LINKS, legacyUrl: legacy } : NO_JOB_LINKS;
  }

  if (WRITEUP_TYPES.includes(appt.appointment_type) && canSeeWriteUps) {
    const key = addressKey(appt.address);
    if (!key.street) return NO_JOB_LINKS;
    // ZIP only rules a row out when both sides have one.
    const hits = (data.writeUps.get(key.street) ?? []).filter(
      (h) => !key.zip || !h.zip || h.zip === key.zip
    );
    if (hits.length === 0) return NO_JOB_LINKS;
    return {
      ...NO_JOB_LINKS,
      writeUpCount: hits.length,
      writeUpOrders: new Set(hits.map((h) => h.orderNumber).filter(Boolean)).size,
      writeUpUrl: writeUpsHref(appt.address),
    };
  }

  return NO_JOB_LINKS;
}

export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
