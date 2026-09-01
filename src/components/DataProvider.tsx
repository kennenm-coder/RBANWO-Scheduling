"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  Appointment,
  Crew,
  RForceOrder,
  TimeOffRequest,
  AvailabilityRule,
  AvailabilityException,
  CalendarBlock,
  AppointmentLink,
  ResourceMapping,
  RForceDismissal,
  FlagResolution,
  MatchRejection,
  TimeBlock,
} from "@/lib/types";
import {
  fetchCrews,
  fetchAppointments,
  fetchRForceOrders,
  fetchTimeOffRequests,
  fetchAvailabilityRules,
  fetchCalendarBlocks,
  upsertCalendarBlock as upsertCalendarBlockInDb,
  deleteCalendarBlock as deleteCalendarBlockInDb,
  fetchActiveLinks,
  fetchResourceMappings,
  fetchDismissals,
  fetchFlagResolutions,
  fetchUnscheduledAppointments,
  createAppointment as createApptInDb,
  updateAppointment as updateApptInDb,
  cancelAppointment as cancelApptInDb,
  unscheduleAppointment as unscheduleApptInDb,
  createTimeOffRequest as createTimeOffInDb,
  updateTimeOffRequest as updateTimeOffInDb,
  deleteTimeOffRequest as deleteTimeOffInDb,
  approveRForceOrder as approveRForceInDb,
  dismissRForceOrder as dismissRForceInDb,
  resolveFlag as resolveFlagInDb,
  unresolveFlag as unresolveFlagInDb,
  fetchMatchRejections,
  rejectMatch as rejectMatchInDb,
  unrejectMatch as unrejectMatchInDb,
  fetchScheduledWorkOrderNumbers,
  fetchImportRunDates,
  recordImportRun,
} from "@/lib/store";
import { detectLatestExportDate } from "@/lib/rforce-staleness";
import { mergeRForceIntoAppointment as mergeInDb, MergeResult } from "@/lib/merge";
import { humanizeConflictMessage } from "@/lib/calendar-utils";
import { subscribeToAppointments } from "@/lib/realtime";
import { useAuth } from "./AuthProvider";
import { addDays, subDays, format } from "date-fns";

interface DataContextValue {
  crews: Crew[];
  appointments: Appointment[];
  unscheduledAppointments: Appointment[];
  rforceOrders: RForceOrder[];
  timeOffRequests: TimeOffRequest[];
  availabilityRules: AvailabilityRule[];
  availabilityExceptions: AvailabilityException[];
  calendarBlocks: CalendarBlock[];
  activeLinks: AppointmentLink[];
  resourceMappings: ResourceMapping[];
  dismissals: RForceDismissal[];
  flagResolutions: FlagResolution[];
  matchRejections: MatchRejection[];
  /** Work orders that already have a placed tile anywhere on the calendar,
   *  including outside the loaded date window. Shared so the Issues page and the
   *  bottom-nav badge count issues the same way. */
  scheduledWorkOrders: Set<string>;
  /** Observed full daily-export dates (YYYY-MM-DD, newest first) — powers the
   *  two-tier "dropped from rForce" cancellation detection. */
  exportDates: string[];
  loading: boolean;
  connected: boolean;
  createAppointment: (
    appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at" | "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id"> & Partial<Pick<Appointment, "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id">>
  ) => Promise<Appointment | null>;
  updateAppointment: (
    id: string,
    version: number,
    updates: Partial<Appointment>
  ) => Promise<Appointment | null>;
  cancelAppointment: (
    id: string,
    version: number,
    reason?: string
  ) => Promise<void>;
  unscheduleAppointment: (
    id: string,
    version: number,
    reason?: string
  ) => Promise<void>;
  mergeRForce: (
    appointment: Appointment,
    rforceOrder: RForceOrder
  ) => Promise<MergeResult>;
  approveRForce: (
    rforceOrder: RForceOrder,
    crewId: string,
    timeBlock: TimeBlock,
    scheduledDate: string,
    override?: boolean
  ) => Promise<Appointment>;
  dismissRForce: (
    workOrderNumber: string,
    rforceDate: string,
    rforceStartTime?: string,
    reason?: string
  ) => Promise<void>;
  resolveFlag: (flagKey: string, notes?: string) => Promise<void>;
  unresolveFlag: (flagKey: string) => Promise<void>;
  rejectMatch: (appointmentId: string, workOrderNumber: string, reason?: string) => Promise<void>;
  unrejectMatch: (appointmentId: string, workOrderNumber: string) => Promise<void>;
  refreshData: () => Promise<void>;
  ensureDateRange: (date: Date) => void;
  addTimeOff: (req: Omit<TimeOffRequest, "id" | "created_at">) => Promise<TimeOffRequest | null>;
  updateTimeOff: (id: string, updates: Partial<Omit<TimeOffRequest, "id" | "created_at">>) => Promise<TimeOffRequest | null>;
  removeTimeOff: (id: string) => Promise<void>;
  saveCalendarBlock: (
    block: Partial<CalendarBlock> & { kind: CalendarBlock["kind"]; start_date: string }
  ) => Promise<CalendarBlock | null>;
  removeCalendarBlock: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

export default function DataProvider({ children }: { children: ReactNode }) {
  const { user, displayName, status } = useAuth();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [unscheduledAppointments, setUnscheduledAppointments] = useState<Appointment[]>([]);
  const [rforceOrders, setRforceOrders] = useState<RForceOrder[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [availabilityExceptions, setAvailabilityExceptions] = useState<AvailabilityException[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [activeLinks, setActiveLinks] = useState<AppointmentLink[]>([]);
  const [resourceMappings, setResourceMappings] = useState<ResourceMapping[]>([]);
  const [dismissals, setDismissals] = useState<RForceDismissal[]>([]);
  const [flagResolutions, setFlagResolutions] = useState<FlagResolution[]>([]);
  const [matchRejections, setMatchRejections] = useState<MatchRejection[]>([]);
  const [scheduledWorkOrders, setScheduledWorkOrders] = useState<Set<string>>(new Set());
  const [exportDates, setExportDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const loadedRangeRef = useRef<{ start: string; end: string } | null>(null);
  const lastResyncRef = useRef(0);
  // Latest auth status, readable inside the focus/wake resync without
  // re-subscribing its listeners on every token refresh.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const loadData = useCallback(async () => {
    try {
      const today = new Date();
      const start = format(subDays(today, 30), "yyyy-MM-dd");
      const end = format(addDays(today, 180), "yyyy-MM-dd");

      const [c, a, r, t, av, cb, links, rm, dism, flagRes, matchRej, unsched, schedWos, runDates] = await Promise.all([
        fetchCrews(),
        fetchAppointments(start, end),
        fetchRForceOrders(),
        fetchTimeOffRequests(),
        fetchAvailabilityRules(),
        fetchCalendarBlocks(),
        fetchActiveLinks(),
        fetchResourceMappings(),
        fetchDismissals(),
        fetchFlagResolutions(),
        fetchMatchRejections(),
        fetchUnscheduledAppointments(),
        fetchScheduledWorkOrderNumbers(),
        fetchImportRunDates(),
      ]);

      // Record today's daily export (if it has run and isn't logged yet) so the
      // export-date history accumulates, then hand the merged list to consumers.
      // Detection/logging is best-effort — never let it break the calendar load.
      let allExportDates = runDates;
      try {
        const detected = detectLatestExportDate(r);
        if (detected && !runDates.includes(detected.date)) {
          allExportDates = [detected.date, ...runDates];
          void recordImportRun(detected.date, detected.orderCount);
        }
      } catch (e) {
        console.error("Export-date detection failed (non-fatal):", e);
      }

      // REMOVED: Auto-cancel on page load.
      // Previously, opening the app would fire-and-forget cancel any appointment
      // whose rForce order had a cancelled status. This violated the principle
      // that rForce must not directly mutate the calendar. Cancellation mismatches
      // are now surfaced as rforce_cancellation_mismatch flags in the Issue Center,
      // requiring an authorized scheduler to confirm cancellation manually.

      setCrews(c);
      setAppointments(a);
      setRforceOrders(r);
      setTimeOffRequests(t);
      setAvailabilityRules(av.rules);
      setAvailabilityExceptions(av.exceptions);
      setCalendarBlocks(cb);
      setActiveLinks(links);
      setResourceMappings(rm);
      setDismissals(dism);
      setFlagResolutions(flagRes);
      setMatchRejections(matchRej);
      setUnscheduledAppointments(unsched);
      setScheduledWorkOrders(new Set(schedWos.map((w) => w.trim().toLowerCase())));
      setExportDates(allExportDates);
      loadedRangeRef.current = { start, end };
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureDateRange = useCallback(
    (date: Date) => {
      if (!loadedRangeRef.current) return;
      const margin = format(addDays(date, 14), "yyyy-MM-dd");
      const marginBefore = format(subDays(date, 14), "yyyy-MM-dd");
      const { start, end } = loadedRangeRef.current;
      if (margin > end || marginBefore < start) {
        const newStart = format(subDays(date, 60), "yyyy-MM-dd");
        const newEnd = format(addDays(date, 180), "yyyy-MM-dd");
        loadedRangeRef.current = { start: newStart, end: newEnd };
        fetchAppointments(newStart, newEnd)
          .then((a) => {
            // A 0-row result here is almost always a transient auth/RLS blip
            // (e.g. a token refresh in flight), not a genuinely empty window —
            // and an empty result would blank the board, flipping every tile to
            // "unconfirmed". Never let an empty refetch overwrite tiles we
            // already hold; real deletes still arrive via the realtime channel.
            // (The view is date-filtered, so keeping the prior range's tiles in
            // state is harmless when the new range really is empty.)
            setAppointments((prev) => (a.length === 0 && prev.length > 0 ? prev : a));
          })
          .catch((err) => {
            // Never wipe the calendar on a failed refetch. Keep the tiles we
            // have and roll the loaded range back so a later navigation retries.
            console.error("Failed to extend loaded date range:", err);
            loadedRangeRef.current = { start, end };
          });
      }
    },
    []
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: route appointments to scheduled or unscheduled lists
  useEffect(() => {
    const unsub = subscribeToAppointments((event, appt) => {
      setConnected(true);

      if (appt.status === "unscheduled") {
        // Route to unscheduled list, remove from scheduled
        setAppointments((prev) => prev.filter((a) => a.id !== appt.id));
        setUnscheduledAppointments((prev) => {
          if (prev.find((a) => a.id === appt.id))
            return prev.map((a) => (a.id === appt.id ? appt : a));
          return [...prev, appt];
        });
      } else {
        // Route to scheduled list, remove from unscheduled
        setUnscheduledAppointments((prev) =>
          prev.filter((a) => a.id !== appt.id)
        );
        setAppointments((prev) => {
          switch (event) {
            case "INSERT":
              if (prev.find((a) => a.id === appt.id)) return prev;
              return [...prev, appt];
            case "UPDATE":
              return prev.map((a) => (a.id === appt.id ? appt : a));
            case "DELETE":
              return prev.filter((a) => a.id !== appt.id);
            default:
              return prev;
          }
        });
      }
    });
    setConnected(true);
    return unsub;
  }, []);

  // Focus/wake resync. The realtime socket can silently miss changes while a tab
  // is backgrounded; when the tab comes back we backfill the loaded window with
  // one query. Throttled so rapid focus flips can't hammer the DB, and it never
  // wipes existing tiles on failure — it just retries on the next focus.
  useEffect(() => {
    const RESYNC_MIN_INTERVAL_MS = 30_000;
    const resync = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // Only backfill when we hold a live authenticated session. A resync fired
      // mid-token-rotation would run under the anon role and RLS would hand back
      // zero rows as a success — silently blanking the board. Skip it instead.
      if (statusRef.current !== "authed") return;
      const range = loadedRangeRef.current;
      if (!range) return;
      const now = Date.now();
      if (now - lastResyncRef.current < RESYNC_MIN_INTERVAL_MS) return;
      lastResyncRef.current = now;
      fetchAppointments(range.start, range.end)
        .then((a) => {
          // Belt-and-suspenders with the auth gate above: never let an empty
          // refetch overwrite a populated board. Real deletions come through
          // the realtime channel, not this backfill.
          setAppointments((prev) => {
            if (a.length === 0 && prev.length > 0) {
              lastResyncRef.current = 0; // allow an immediate retry next focus
              return prev;
            }
            return a;
          });
        })
        .catch((err) => {
          console.error("Focus resync failed (keeping current tiles):", err);
          lastResyncRef.current = 0; // allow an immediate retry next focus
        });
    };
    const onVisible = () => {
      if (!document.hidden) resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resync);
    };
  }, []);

  const handleCreate = useCallback(
    async (
      appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at" | "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id"> & Partial<Pick<Appointment, "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id">>
    ) => {
      const result = await createApptInDb(appt);
      if (result) {
        if (result.status === "unscheduled") {
          setUnscheduledAppointments((prev) => [...prev, result]);
        } else {
          setAppointments((prev) => {
            if (prev.find((a) => a.id === result.id)) return prev;
            return [...prev, result];
          });
        }
      }
      return result;
    },
    []
  );

  const handleUpdate = useCallback(
    async (id: string, version: number, updates: Partial<Appointment>) => {
      const result = await updateApptInDb(id, version, updates);
      if (result) {
        if (result.status === "unscheduled") {
          // Moved to unscheduled
          setAppointments((prev) => prev.filter((a) => a.id !== id));
          setUnscheduledAppointments((prev) => {
            if (prev.find((a) => a.id === result.id))
              return prev.map((a) => (a.id === result.id ? result : a));
            return [...prev, result];
          });
        } else {
          // Scheduled: ensure in calendar list, remove from unscheduled
          setUnscheduledAppointments((prev) =>
            prev.filter((a) => a.id !== id)
          );
          setAppointments((prev) =>
            prev.map((a) => (a.id === result.id ? result : a))
          );
        }
      }
      return result;
    },
    []
  );

  const handleCancel = useCallback(
    async (id: string, version: number, reason?: string) => {
      await cancelApptInDb(id, version, reason);
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "cancelled" as const } : a
        )
      );
    },
    []
  );

  const handleUnschedule = useCallback(
    async (id: string, version: number, reason?: string) => {
      const result = await unscheduleApptInDb(id, version, reason);
      if (result) {
        // Remove from calendar
        setAppointments((prev) => prev.filter((a) => a.id !== id));
        // Add to unscheduled
        setUnscheduledAppointments((prev) => [...prev, result]);
      }
    },
    []
  );

  const handleMerge = useCallback(
    async (appointment: Appointment, rforceOrder: RForceOrder) => {
      const result = await mergeInDb(appointment, rforceOrder);
      // Update the appointment in local state
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === result.appointment.id ? result.appointment : a
        )
      );
      if (result.link) {
        setActiveLinks((prev) => [...prev, result.link!]);
      }
      return result;
    },
    []
  );

  const handleAddTimeOff = useCallback(
    async (req: Omit<TimeOffRequest, "id" | "created_at">) => {
      const result = await createTimeOffInDb(req);
      if (result) {
        setTimeOffRequests((prev) => [...prev, result]);
      }
      return result;
    },
    []
  );

  const handleUpdateTimeOff = useCallback(
    async (id: string, updates: Partial<Omit<TimeOffRequest, "id" | "created_at">>) => {
      const result = await updateTimeOffInDb(id, updates);
      if (result) {
        setTimeOffRequests((prev) =>
          prev.map((r) => (r.id === id ? result : r))
        );
      }
      return result;
    },
    []
  );

  const handleRemoveTimeOff = useCallback(
    async (id: string) => {
      await deleteTimeOffInDb(id);
      setTimeOffRequests((prev) => prev.filter((r) => r.id !== id));
    },
    []
  );

  const handleSaveCalendarBlock = useCallback(
    async (
      block: Partial<CalendarBlock> & { kind: CalendarBlock["kind"]; start_date: string }
    ) => {
      const result = await upsertCalendarBlockInDb(block);
      if (result) {
        setCalendarBlocks((prev) => {
          const existing = prev.findIndex((b) => b.id === result.id);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = result;
            return next;
          }
          return [...prev, result];
        });
      }
      return result;
    },
    []
  );

  const handleRemoveCalendarBlock = useCallback(
    async (id: string) => {
      await deleteCalendarBlockInDb(id);
      setCalendarBlocks((prev) => prev.filter((b) => b.id !== id));
    },
    []
  );

  const handleApproveRForce = useCallback(
    async (
      rforceOrder: RForceOrder,
      crewId: string,
      timeBlock: TimeBlock,
      scheduledDate: string,
      override: boolean = false
    ) => {
      // Throws on failure — caller should catch and surface the message.
      // Translate the DB's UUID-based conflict text into a human sentence
      // (who is booked, when) using the appointments/crews already in memory.
      let result;
      try {
        result = await approveRForceInDb(rforceOrder, crewId, timeBlock, scheduledDate, user?.id, displayName, undefined, override);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("SCHEDULING_CONFLICT")) {
          throw new Error("SCHEDULING_CONFLICT: " + humanizeConflictMessage(msg, appointments, crews));
        }
        throw err;
      }
      setAppointments((prev) => {
        if (prev.find((a) => a.id === result.appointment.id)) {
          return prev.map((a) => (a.id === result.appointment.id ? result.appointment : a));
        }
        return [...prev, result.appointment];
      });
      // If approval placed a tile that was sitting in the queue, drop it from the
      // unscheduled list so the queue and calendar stay consistent.
      setUnscheduledAppointments((prev) => prev.filter((a) => a.id !== result.appointment.id));
      if (result.link) {
        setActiveLinks((prev) => {
          if (prev.find((l) => l.id === result.link!.id)) return prev;
          return [...prev, result.link!];
        });
      }
      return result.appointment;
    },
    [user?.id, displayName, appointments, crews]
  );

  const handleDismissRForce = useCallback(
    async (
      workOrderNumber: string,
      rforceDate: string,
      rforceStartTime?: string,
      reason?: string
    ) => {
      const result = await dismissRForceInDb(workOrderNumber, rforceDate, rforceStartTime, reason);
      if (result) {
        setDismissals((prev) => [...prev, result]);
      }
    },
    []
  );

  const handleResolveFlag = useCallback(
    async (flagKey: string, notes?: string) => {
      const result = await resolveFlagInDb(flagKey, notes);
      if (result) {
        setFlagResolutions((prev) => {
          const existing = prev.findIndex((r) => r.flag_key === flagKey);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = result;
            return next;
          }
          return [...prev, result];
        });
      }
    },
    []
  );

  const handleUnresolveFlag = useCallback(
    async (flagKey: string) => {
      await unresolveFlagInDb(flagKey);
      setFlagResolutions((prev) => prev.filter((r) => r.flag_key !== flagKey));
    },
    []
  );

  const handleRejectMatch = useCallback(
    async (appointmentId: string, workOrderNumber: string, reason?: string) => {
      const result = await rejectMatchInDb(appointmentId, workOrderNumber, user?.id, reason);
      if (result) {
        setMatchRejections((prev) => [...prev, result]);
      }
    },
    [user]
  );

  const handleUnrejectMatch = useCallback(
    async (appointmentId: string, workOrderNumber: string) => {
      await unrejectMatchInDb(appointmentId, workOrderNumber);
      setMatchRejections((prev) =>
        prev.filter((r) => !(r.appointment_id === appointmentId && r.work_order_number === workOrderNumber))
      );
    },
    []
  );

  return (
    <DataContext.Provider
      value={{
        crews,
        appointments,
        unscheduledAppointments,
        rforceOrders,
        timeOffRequests,
        availabilityRules,
        availabilityExceptions,
        calendarBlocks,
        activeLinks,
        resourceMappings,
        dismissals,
        flagResolutions,
        matchRejections,
        scheduledWorkOrders,
        exportDates,
        loading,
        connected,
        createAppointment: handleCreate,
        updateAppointment: handleUpdate,
        cancelAppointment: handleCancel,
        unscheduleAppointment: handleUnschedule,
        mergeRForce: handleMerge,
        approveRForce: handleApproveRForce,
        dismissRForce: handleDismissRForce,
        resolveFlag: handleResolveFlag,
        unresolveFlag: handleUnresolveFlag,
        rejectMatch: handleRejectMatch,
        unrejectMatch: handleUnrejectMatch,
        refreshData: loadData,
        ensureDateRange,
        addTimeOff: handleAddTimeOff,
        updateTimeOff: handleUpdateTimeOff,
        removeTimeOff: handleRemoveTimeOff,
        saveCalendarBlock: handleSaveCalendarBlock,
        removeCalendarBlock: handleRemoveCalendarBlock,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
