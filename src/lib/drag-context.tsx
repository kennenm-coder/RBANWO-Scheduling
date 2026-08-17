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

interface SchedulerDragValue {
  draggedOrder: RForceOrder | null;
  draggedAppointment: DraggedAppointmentInfo | null;
  resizingAppointment: ResizeInfo | null;
  setDraggedOrder: (order: RForceOrder | null) => void;
  setDraggedAppointment: (info: DraggedAppointmentInfo | null) => void;
  setResizingAppointment: (info: ResizeInfo | null) => void;
  clearDrag: () => void;
}

const SchedulerDragContext = createContext<SchedulerDragValue | null>(null);

export function SchedulerDragProvider({ children }: { children: React.ReactNode }) {
  const [draggedOrder, setOrder] = useState<RForceOrder | null>(null);
  const [draggedAppointment, setAppointment] = useState<DraggedAppointmentInfo | null>(null);
  const [resizingAppointment, setResize] = useState<ResizeInfo | null>(null);

  const clearDrag = useCallback(() => {
    setOrder(null);
    setAppointment(null);
    setResize(null);
  }, []);
  const setDraggedOrder = useCallback((order: RForceOrder | null) => {
    setOrder(order);
    if (order) {
      setAppointment(null);
      setResize(null);
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
      setDraggedOrder,
      setDraggedAppointment,
      setResizingAppointment,
      clearDrag,
    }),
    [draggedOrder, draggedAppointment, resizingAppointment, setDraggedOrder, setDraggedAppointment, setResizingAppointment, clearDrag]
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
  setDraggedOrder: () => {},
  setDraggedAppointment: () => {},
  setResizingAppointment: () => {},
  clearDrag: () => {},
};

export function useSchedulerDrag(): SchedulerDragValue {
  return useContext(SchedulerDragContext) ?? NOOP_DRAG;
}
