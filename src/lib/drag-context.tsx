"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Appointment, RForceOrder, TimeBlock } from "./types";

export interface DraggedAppointmentInfo {
  appointment: Appointment;
  sourceCrewId: string;
  sourceDate: string;
  sourceTimeBlock: TimeBlock | null;
}

export interface ResizeInfo {
  appointmentId: string;
  originalTimeBlock: TimeBlock;
}

/** Occupancy the scheduler chose on the queue tile before dragging it out. */
export interface DraggedMeta {
  /** Hours the job should occupy (null when full-day). */
  hours: number | null;
  /** Whether the tile was marked full-day. */
  fullDay: boolean;
}

interface SchedulerDragValue {
  draggedOrder: RForceOrder | null;
  draggedAppointment: DraggedAppointmentInfo | null;
  resizingAppointment: ResizeInfo | null;
  /** Queue-tile occupancy for the current order drag (null when not dragging one). */
  draggedMeta: DraggedMeta | null;
  setDraggedOrder: (order: RForceOrder | null) => void;
  setDraggedAppointment: (info: DraggedAppointmentInfo | null) => void;
  setResizingAppointment: (info: ResizeInfo | null) => void;
  setDraggedMeta: (meta: DraggedMeta | null) => void;
  clearDrag: () => void;
}

const SchedulerDragContext = createContext<SchedulerDragValue | null>(null);

export function SchedulerDragProvider({ children }: { children: React.ReactNode }) {
  const [draggedOrder, setOrder] = useState<RForceOrder | null>(null);
  const [draggedAppointment, setAppointment] = useState<DraggedAppointmentInfo | null>(null);
  const [resizingAppointment, setResize] = useState<ResizeInfo | null>(null);
  const [draggedMeta, setMeta] = useState<DraggedMeta | null>(null);

  const clearDrag = useCallback(() => {
    setOrder(null);
    setAppointment(null);
    setResize(null);
    setMeta(null);
  }, []);
  const setDraggedMeta = useCallback((meta: DraggedMeta | null) => setMeta(meta), []);
  const setDraggedOrder = useCallback((order: RForceOrder | null) => {
    setOrder(order);
    if (order) {
      setAppointment(null);
      setResize(null);
    } else {
      setMeta(null);
    }
  }, []);
  const setDraggedAppointment = useCallback((info: DraggedAppointmentInfo | null) => {
    setAppointment(info);
    if (info) {
      setOrder(null);
      setResize(null);
    }
  }, []);
  const setResizingAppointment = useCallback((info: ResizeInfo | null) => {
    setResize(info);
    if (info) {
      setOrder(null);
      setAppointment(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      draggedOrder,
      draggedAppointment,
      resizingAppointment,
      draggedMeta,
      setDraggedOrder,
      setDraggedAppointment,
      setResizingAppointment,
      setDraggedMeta,
      clearDrag,
    }),
    [draggedOrder, draggedAppointment, resizingAppointment, draggedMeta, setDraggedOrder, setDraggedAppointment, setResizingAppointment, setDraggedMeta, clearDrag]
  );

  return <SchedulerDragContext.Provider value={value}>{children}</SchedulerDragContext.Provider>;
}

/**
 * No-op fallback used when a draggable card (e.g. QueueItemCard) is rendered
 * outside the scheduler — like the standalone /queue page, which has no drop
 * targets. Drag simply does nothing there rather than crashing the page.
 */
const NOOP_DRAG: SchedulerDragValue = {
  draggedOrder: null,
  draggedAppointment: null,
  resizingAppointment: null,
  draggedMeta: null,
  setDraggedOrder: () => {},
  setDraggedAppointment: () => {},
  setResizingAppointment: () => {},
  setDraggedMeta: () => {},
  clearDrag: () => {},
};

export function useSchedulerDrag(): SchedulerDragValue {
  return useContext(SchedulerDragContext) ?? NOOP_DRAG;
}
