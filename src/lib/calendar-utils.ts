import { Appointment, TimeBlock, AppointmentType, Crew } from "./types";
import {
  startOfWeek,
  addDays,
  format,
  parseISO,
  isSameDay,
} from "date-fns";

export const MEASURE_TIME_BLOCKS: TimeBlock[] = [
  "9-10",
  "10-12",
  "12-2",
  "2-4",
  "4-6",
];

export const INSTALL_TIME_BLOCKS: TimeBlock[] = ["full_day"];

export function timeBlockLabel(block: TimeBlock): string {
  switch (block) {
    case "9-10":
      return "9:00 – 10:00 AM";
    case "10-12":
      return "10:00 AM – 12:00 PM";
    case "12-2":
      return "12:00 – 2:00 PM";
    case "2-4":
      return "2:00 – 4:00 PM";
    case "4-6":
      return "4:00 – 6:00 PM";
    case "full_day":
      return "Full Day (8 AM)";
  }
}

export function timeBlockStartEnd(block: TimeBlock): {
  start: string;
  end: string;
} {
  switch (block) {
    case "9-10":
      return { start: "09:00", end: "10:00" };
    case "10-12":
      return { start: "10:00", end: "12:00" };
    case "12-2":
      return { start: "12:00", end: "14:00" };
    case "2-4":
      return { start: "14:00", end: "16:00" };
    case "4-6":
      return { start: "16:00", end: "18:00" };
    case "full_day":
      return { start: "08:00", end: "16:00" };
  }
}

export function getTimeBlocksForType(
  type: AppointmentType
): TimeBlock[] {
  if (type === "tech_measure") return MEASURE_TIME_BLOCKS;
  return INSTALL_TIME_BLOCKS;
}

export function getAppointmentsForDay(
  appointments: Appointment[],
  date: Date
): Appointment[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return appointments.filter((a) => {
    if (a.status === "cancelled") return false;
    if (a.scheduled_date === dateStr) return true;
    if (a.duration_days > 1) {
      const start = parseISO(a.scheduled_date);
      for (let d = 0; d < a.duration_days; d++) {
        if (isSameDay(addDays(start, d), date)) return true;
      }
    }
    return false;
  });
}

export function getAppointmentsForCrewAndDay(
  appointments: Appointment[],
  crewId: string,
  date: Date
): Appointment[] {
  return getAppointmentsForDay(appointments, date).filter(
    (a) => a.crew_id === crewId || a.secondary_crew_id === crewId
  );
}

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatDateShort(date: Date): string {
  return format(date, "MMM d");
}

export function formatDateFull(date: Date): string {
  return format(date, "EEEE, MMMM d, yyyy");
}

export function formatWeekRange(date: Date): string {
  const days = getWeekDays(date);
  return `${format(days[0], "MMM d")} – ${format(days[6], "MMM d, yyyy")}`;
}

export function typeColor(type: AppointmentType): string {
  switch (type) {
    case "tech_measure":
      return "bg-amber-500";
    case "install":
      return "bg-install";
    case "service":
      return "bg-service";
    case "jip":
      return "bg-jsv";
  }
}

export function typeColorText(type: AppointmentType): string {
  switch (type) {
    case "tech_measure":
      return "text-amber-600";
    case "install":
      return "text-install";
    case "service":
      return "text-service";
    case "jip":
      return "text-jsv";
  }
}

export function typeLabel(type: AppointmentType): string {
  switch (type) {
    case "tech_measure":
      return "Tech Measure";
    case "install":
      return "Install";
    case "service":
      return "Service";
    case "jip":
      return "JIP";
  }
}

export function crewTypeLabel(type: Crew["crew_type"]): string {
  switch (type) {
    case "measure_tech":
      return "Measure Tech";
    case "install_in_house":
      return "Install (In-House)";
    case "install_sub":
      return "Install (Sub)";
    case "jip":
      return "JIP";
    case "svc":
      return "Service";
  }
}
