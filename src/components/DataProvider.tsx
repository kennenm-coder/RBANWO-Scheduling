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
} from "@/lib/store";
import { mergeRForceIntoAppointment as mergeInDb, MergeResult } from "@/lib/merge";
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
  activeLinks: AppointmentLink[];
  resourceMappings: ResourceMapping[];
  dismissals: RForceDismissal[];
  flagResolutions: FlagResolution[];
  matchRejections: MatchRejection[];
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
    scheduledDate: string
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
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

export default function DataProvider({ children }: { children: ReactNode }) {
  const { user, displayName } = useAuth();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [unscheduledAppointments, setUnscheduledAppointments] = useState<Appointment[]>([]);
  const [rforceOrders, setRforceOrders] = useState<RForceOrder[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [availabilityExceptions, setAvailabilityExceptions] = useState<AvailabilityException[]>([]);
  const [activeLinks, setActiveLinks] = useState<AppointmentLink[]>([]);
  const [resourceMappings, setResourceMappings] = useState<ResourceMapping[]>([]);
  const [dismissals, setDismissals] = useState<RForceDismissal[]>([]);
  const [flagResolutions, setFlagResolutions] = useState<FlagResolution[]>([]);
  const [matchRejections, setMatchRejections] = useState<MatchRejection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const loadedRangeRef = useRef<{ start: string; end: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const today = new Date();
      const start = format(subDays(today, 30), "yyyy-MM-dd");
      const end = format(addDays(today, 180), "yyyy-MM-dd");

      const [c, a, r, t, av, links, rm, dism, flagRes, matchRej, unsched] = await Promise.all([
        fetchCrews(),
        fetchAppointments(start, end),
        fetchRForceOrders(),
        fetchTimeOffRequests(),
        fetchAvailabilityRules(),
        fetchActiveLinks(),
        fetchResourceMappings(),
        fetchDismissals(),
        fetchFlagResolutions(),
        fetchMatchRejections(),
        fetchUnscheduledAppointments(),
      ]);

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
      setActiveLinks(links);
      setResourceMappings(rm);
      setDismissals(dism);
      setFlagResolutions(flagRes);
      setMatchRejections(matchRej);
      setUnscheduledAppointments(unsched);
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
        fetchAppointments(newStart, newEnd).then((a) => {
          setAppointments(a);
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

  const handleApproveRForce = useCallback(
    async (
      rforceOrder: RForceOrder,
      crewId: string,
      timeBlock: TimeBlock,
      scheduledDate: string
    ) => {
      // Throws on failure — caller should catch and surface the message
      const result = await approveRForceInDb(rforceOrder, crewId, timeBlock, scheduledDate, user?.id, displayName);
      setAppointments((prev) => {
        if (prev.find((a) => a.id === result.appointment.id)) return prev;
        return [...prev, result.appointment];
      });
      if (result.link) {
        setActiveLinks((prev) => [...prev, result.link!]);
      }
      return result.appointment;
    },
    [user?.id, displayName]
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
        activeLinks,
        resourceMappings,
        dismissals,
        flagResolutions,
        matchRejections,
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
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
