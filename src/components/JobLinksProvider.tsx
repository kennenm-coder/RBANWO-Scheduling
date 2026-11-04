"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment } from "@/lib/types";
import {
  EMPTY_JOB_LINKS,
  NO_JOB_LINKS,
  resolveJobLinks,
  type JobLinkData,
  type JobLinkState,
} from "@/lib/job-links";
import {
  fetchActiveWriteUpIndex,
  fetchLegacyLinkMap,
  fetchLinkedJobMap,
  upsertLegacyLink,
  deleteLegacyLink,
} from "@/lib/job-links-store";
import { useAuth } from "./AuthProvider";

interface JobLinksContextValue {
  data: JobLinkData;
  setLegacyLink: (orderNumber: string, url: string, updatedBy?: string) => Promise<boolean>;
  clearLegacyLink: (orderNumber: string) => Promise<boolean>;
}

// The default is inert (no data, writes refuse) so anything rendered outside
// the provider — tests, other routes — just shows no chips. It never throws.
const JobLinksContext = createContext<JobLinksContextValue>({
  data: EMPTY_JOB_LINKS,
  setLegacyLink: async () => false,
  clearLegacyLink: async () => false,
});

const REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * Loads install-paperwork status (material list / legacy link / active
 * write-ups) for the calendar's tiles.
 *
 * Deliberately separate from DataProvider: it starts after first paint, never
 * blocks anything, and every failure leaves the previous data (or none) in
 * place. Worst case is "no chips".
 */
export default function JobLinksProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [data, setData] = useState<JobLinkData>(EMPTY_JOB_LINKS);
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    lastLoadRef.current = Date.now();
    const [legacy, linked, writeUps] = await Promise.all([
      fetchLegacyLinkMap().catch(() => null),
      fetchLinkedJobMap().catch(() => null),
      fetchActiveWriteUpIndex().catch(() => null),
    ]);
    // Each slice is replaced only if its own read succeeded.
    setData((prev) => ({
      legacy: legacy ?? prev.legacy,
      linked: linked ?? prev.linked,
      writeUps: writeUps ?? prev.writeUps,
    }));
  }, []);

  useEffect(() => {
    if (status !== "authed") return;
    // After first paint, so it can never delay the calendar.
    const t = setTimeout(load, 300);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < REFRESH_MIN_INTERVAL_MS) return;
      void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [status, load]);

  const setLegacyLink = useCallback(async (orderNumber: string, url: string, updatedBy?: string) => {
    const ok = await upsertLegacyLink(orderNumber, url, updatedBy);
    if (ok) {
      setData((prev) => ({ ...prev, legacy: new Map(prev.legacy).set(orderNumber, url) }));
    }
    return ok;
  }, []);

  const clearLegacyLink = useCallback(async (orderNumber: string) => {
    const ok = await deleteLegacyLink(orderNumber);
    if (ok) {
      setData((prev) => {
        const legacy = new Map(prev.legacy);
        legacy.delete(orderNumber);
        return { ...prev, legacy };
      });
    }
    return ok;
  }, []);

  const value = useMemo(() => ({ data, setLegacyLink, clearLegacyLink }), [data, setLegacyLink, clearLegacyLink]);

  return <JobLinksContext.Provider value={value}>{children}</JobLinksContext.Provider>;
}

export function useJobLinkActions() {
  const { setLegacyLink, clearLegacyLink } = useContext(JobLinksContext);
  return { setLegacyLink, clearLegacyLink };
}

/** Chip state for one appointment. Never throws; NO_JOB_LINKS when unknown. */
export function useJobLinks(
  appt: Pick<Appointment, "appointment_type" | "order_number" | "address"> | null | undefined
): JobLinkState {
  const { data } = useContext(JobLinksContext);
  const type = appt?.appointment_type;
  const order = appt?.order_number;
  const address = appt?.address;
  return useMemo(() => {
    if (!type) return NO_JOB_LINKS;
    return resolveJobLinks(
      { appointment_type: type, order_number: order ?? null, address: address ?? "" },
      data,
      true // every scheduling role (admin / scheduling / scheduling_manager) may see write-ups
    );
  }, [data, type, order, address]);
}
