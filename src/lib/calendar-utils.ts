import { Appointment, TimeBlock, AppointmentType, Crew, RForceOrder } from "./types";
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
    case "lswp":
      return "bg-teal-500";
    case "hoa":
      return "bg-cyan-500";
    case "paint_stain":
      return "bg-rose-500";
    default:
      return "bg-gray-500";
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
    case "lswp":
      return "text-teal-600";
    case "hoa":
      return "text-cyan-600";
    case "paint_stain":
      return "text-rose-600";
    default:
      return "text-gray-600";
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
    case "lswp":
      return "LSWP";
    case "hoa":
      return "HOA";
    case "paint_stain":
      return "Paint/Stain";
    default:
      return type;
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
    case "misc":
      return "Misc";
  }
}

function timeToBlock(hour: number): TimeBlock {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}

function matchCrewByName(resourceName: string, crews: Crew[]): Crew | undefined {
  const lower = resourceName.toLowerCase().trim();
  const exact = crews.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;
  const firstName = lower.split(" ")[0];
  return crews.find((c) => c.name.toLowerCase().split(" ")[0] === firstName);
}

export interface RForceCalendarItem {
  rforceOrder: RForceOrder;
  crewId: string;
  timeBlock: TimeBlock;
}

export function checkDiscrepancy(
  appointment: Appointment,
  rforceOrders: RForceOrder[]
): boolean {
  if (!appointment.work_order_number) return false;
  const rf = rforceOrders.find(
    (r) => r.work_order_number === appointment.work_order_number
  );
  if (!rf) return false;
  if (rf.scheduled_start) {
    const rfDate = rf.scheduled_start.slice(0, 10);
    if (rfDate !== appointment.scheduled_date) return true;
  }
  return false;
}

export function getRForceItemsForDay(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  crews: Crew[],
  date: Date
): RForceCalendarItem[] {
  const dateStr = format(date, "yyyy-MM-dd");
  const linkedWOs = new Set(
    appointments
      .filter((a) => a.work_order_number && a.status !== "cancelled")
      .map((a) => a.work_order_number)
  );

  const items: RForceCalendarItem[] = [];

  for (const rf of rforceOrders) {
    if (!rf.scheduled_start) continue;
    if (linkedWOs.has(rf.work_order_number)) continue;
    if (rf.wo_status === "Appt Complete / Closed" || rf.wo_status === "Canceled") continue;

    const startDate = rf.scheduled_start.slice(0, 10);
    const endDate = rf.scheduled_end ? rf.scheduled_end.slice(0, 10) : startDate;
    if (dateStr < startDate || dateStr > endDate) continue;

    const resourceName =
      rf.tech_measure_name || rf.installer || rf.service_rep || rf.primary_resource;
    if (!resourceName) continue;

    const crew = matchCrewByName(resourceName, crews);
    if (!crew) continue;

    const hour = parseInt(rf.scheduled_start.slice(11, 13), 10);
    const isMeasure = crew.crew_type === "measure_tech";
    const timeBlock: TimeBlock = isMeasure ? timeToBlock(hour) : "full_day";

    items.push({ rforceOrder: rf, crewId: crew.id, timeBlock });
  }

  return items;
}
