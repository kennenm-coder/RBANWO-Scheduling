import { RForceOrder, Appointment, TimeBlock } from "./types";

// ── Queue item drag (existing) ──

let _draggedOrder: RForceOrder | null = null;

export function setDraggedOrder(order: RForceOrder | null) {
  _draggedOrder = order;
  if (order) _draggedAppointment = null;
}

export function getDraggedOrder(): RForceOrder | null {
  return _draggedOrder;
}

// ── Appointment drag (move between crews/dates) ──

export interface DraggedAppointmentInfo {
  appointment: Appointment;
  sourceCrewId: string;
  sourceDate: string;
  sourceTimeBlock: TimeBlock | null;
}

let _draggedAppointment: DraggedAppointmentInfo | null = null;

export function setDraggedAppointment(info: DraggedAppointmentInfo | null) {
  _draggedAppointment = info;
  if (info) _draggedOrder = null;
}

export function getDraggedAppointment(): DraggedAppointmentInfo | null {
  return _draggedAppointment;
}

// ── Resize drag (extend/shrink time blocks) ──

export interface ResizeInfo {
  appointmentId: string;
  originalTimeBlock: TimeBlock;
}

let _resizing: ResizeInfo | null = null;

export function setResizingAppointment(info: ResizeInfo | null) {
  _resizing = info;
  if (info) {
    _draggedOrder = null;
    _draggedAppointment = null;
  }
}

export function getResizingAppointment(): ResizeInfo | null {
  return _resizing;
}
