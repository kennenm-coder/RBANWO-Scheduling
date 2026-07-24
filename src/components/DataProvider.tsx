"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  Appointment,
  Crew,
  RForceOrder,
  TimeOffRequest,
} from "@/lib/types";
import {
  fetchCrews,
  fetchAppointments,
  fetchRForceOrders,
  fetchTimeOffRequests,
  createAppointment as createApptInDb,
  updateAppointment as updateApptInDb,
  cancelAppointment as cancelApptInDb,
} from "@/lib/store";
import { subscribeToAppointments } from "@/lib/realtime";
import { addDays, subDays, format } from "date-fns";

interface DataContextValue {
  crews: Crew[];
  appointments: Appointment[];
  rforceOrders: RForceOrder[];
  timeOffRequests: TimeOffRequest[];
  loading: boolean;
  connected: boolean;
  createAppointment: (
    appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at">
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
  refreshData: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

export default function DataProvider({ children }: { children: ReactNode }) {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [rforceOrders, setRforceOrders] = useState<RForceOrder[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const loadData = useCallback(async () => {
    const today = new Date();
    const start = format(subDays(today, 30), "yyyy-MM-dd");
    const end = format(addDays(today, 90), "yyyy-MM-dd");

    const [c, a, r, t] = await Promise.all([
      fetchCrews(),
      fetchAppointments(start, end),
      fetchRForceOrders(),
      fetchTimeOffRequests(),
    ]);

    setCrews(c);
    setAppointments(a);
    setRforceOrders(r);
    setTimeOffRequests(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsub = subscribeToAppointments((event, appt) => {
      setConnected(true);
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
    });
    setConnected(true);
    return unsub;
  }, []);

  const handleCreate = useCallback(
    async (
      appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at">
    ) => {
      const result = await createApptInDb(appt);
      if (result) {
        setAppointments((prev) => {
          if (prev.find((a) => a.id === result.id)) return prev;
          return [...prev, result];
        });
      }
      return result;
    },
    []
  );

  const handleUpdate = useCallback(
    async (id: string, version: number, updates: Partial<Appointment>) => {
      const result = await updateApptInDb(id, version, updates);
      if (result) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === result.id ? result : a))
        );
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

  return (
    <DataContext.Provider
      value={{
        crews,
        appointments,
        rforceOrders,
        timeOffRequests,
        loading,
        connected,
        createAppointment: handleCreate,
        updateAppointment: handleUpdate,
        cancelAppointment: handleCancel,
        refreshData: loadData,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
