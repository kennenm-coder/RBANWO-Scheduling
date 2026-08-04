import {
  Appointment,
  TimeBlock,
  AppointmentType,
  Crew,
  RForceOrder,
  ResourceMapping,
  AppointmentLink,
  RForceDismissal,
  RForceDisplayItem,
  RForceDisplayMode,
  ReconciliationDifferences,
} from "./types";
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

export function appointmentSpansBlock(appointment: Appointment, block: TimeBlock): boolean {
  if (!appointment.time_block || block === "full_day") return appointment.time_block === block;
  if (!appointment.time_block_end) return appointment.time_block === block;
  const startIdx = MEASURE_TIME_BLOCKS.indexOf(appointment.time_block);
  const endIdx = MEASURE_TIME_BLOCKS.indexOf(appointment.time_block_end);
  const blockIdx = MEASURE_TIME_BLOCKS.indexOf(block);
  if (startIdx < 0 || endIdx < 0 || blockIdx < 0) return false;
  return blockIdx >= startIdx && blockIdx <= endIdx;
}

export function getSpannedBlocks(appointment: Appointment): TimeBlock[] {
  if (!appointment.time_block) return [];
  if (!appointment.time_block_end) return [appointment.time_block];
  const startIdx = MEASURE_TIME_BLOCKS.indexOf(appointment.time_block);
  const endIdx = MEASURE_TIME_BLOCKS.indexOf(appointment.time_block_end);
  if (startIdx < 0 || endIdx < 0) return [appointment.time_block];
  return MEASURE_TIME_BLOCKS.slice(startIdx, endIdx + 1);
}

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
    case "second":
      return "Second";
    case "management":
      return "Management";
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

export function matchCrewByMapping(
  resourceName: string,
  crews: Crew[],
  mappings: ResourceMapping[]
): Crew | undefined {
  const lower = resourceName.toLowerCase().trim();
  const mapping = mappings.find((m) => m.raw_name.toLowerCase() === lower);
  if (mapping) return crews.find((c) => c.id === mapping.crew_id);
  return undefined;
}

function matchCrewByName(resourceName: string, crews: Crew[], mappings?: ResourceMapping[]): Crew | undefined {
  if (mappings && mappings.length > 0) {
    const mapped = matchCrewByMapping(resourceName, crews, mappings);
    if (mapped) return mapped;
  }
  const lower = resourceName.toLowerCase().trim();
  const exact = crews.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;
  const aliasMatch = crews.find((c) =>
    c.aliases?.some((a) => a.toLowerCase() === lower)
  );
  if (aliasMatch) return aliasMatch;
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
  rforceOrders: RForceOrder[],
  crews?: Crew[],
  mappings?: ResourceMapping[]
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
  if (crews) {
    const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
    if (rfResource) {
      const crew = crews.find((c) => c.id === appointment.crew_id);
      if (!crew) return false;
      const matched = matchCrewByName(rfResource, crews, mappings);
      if (matched && matched.id !== crew.id) return true;
      if (!matched) {
        if (crew.name.toLowerCase().split(" ")[0] !== rfResource.toLowerCase().split(" ")[0]) {
          return true;
        }
      }
    }
  }
  return false;
}

export function getRForceItemsForDay(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  crews: Crew[],
  date: Date,
  mappings?: ResourceMapping[]
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
      rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
    if (!resourceName) continue;

    const crew = matchCrewByName(resourceName, crews, mappings);
    if (!crew) continue;

    const hour = parseInt(rf.scheduled_start.slice(11, 13), 10);
    const isMeasure = crew.crew_type === "measure_tech";
    const timeBlock: TimeBlock = isMeasure ? timeToBlock(hour) : "full_day";

    items.push({ rforceOrder: rf, crewId: crew.id, timeBlock });
  }

  return items;
}

export const WO_TYPE_MAP: Record<string, AppointmentType> = {
  "Tech Measure": "tech_measure",
  Install: "install",
  Service: "service",
  JIP: "jip",
};

const TIME_BLOCK_HOUR: Record<TimeBlock, number> = {
  "9-10": 9,
  "10-12": 10,
  "12-2": 12,
  "2-4": 14,
  "4-6": 16,
  full_day: 8,
};

function compareLinkedPair(
  appt: Appointment,
  rf: RForceOrder,
  crews: Crew[],
  mappings?: ResourceMapping[]
): ReconciliationDifferences | null {
  const diffs: ReconciliationDifferences = {};
  let hasDiff = false;

  if (rf.scheduled_start) {
    const rfDate = rf.scheduled_start.slice(0, 10);
    if (rfDate !== appt.scheduled_date) {
      diffs.date = { app: appt.scheduled_date, rforce: rfDate };
      hasDiff = true;
    }
  }

  const rfResource =
    rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
  if (rfResource) {
    const appCrew = crews.find((c) => c.id === appt.crew_id);
    const matched = matchCrewByName(rfResource, crews, mappings);
    if (appCrew && matched && matched.id !== appCrew.id) {
      diffs.crew = { app: appCrew.name, rforce: rfResource };
      hasDiff = true;
    } else if (appCrew && !matched) {
      if (appCrew.name.toLowerCase().split(" ")[0] !== rfResource.toLowerCase().split(" ")[0]) {
        diffs.crew = { app: appCrew.name, rforce: rfResource };
        hasDiff = true;
      }
    }
  }

  if (rf.scheduled_start && appt.time_block) {
    const rfHour = parseInt(rf.scheduled_start.slice(11, 13), 10);
    const expectedHour = TIME_BLOCK_HOUR[appt.time_block];
    if (!isNaN(rfHour) && expectedHour !== undefined && rfHour !== expectedHour) {
      diffs.time = { app: appt.time_block, rforce: `hour ${rfHour}` };
      hasDiff = true;
    }
  }

  const rfTypeMapped = rf.work_order_type ? WO_TYPE_MAP[rf.work_order_type] : undefined;
  if (rfTypeMapped && rfTypeMapped !== appt.appointment_type) {
    diffs.type = { app: appt.appointment_type, rforce: rf.work_order_type || "unknown" };
    hasDiff = true;
  }

  return hasDiff ? diffs : null;
}

export function getRForceDisplayItems(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  activeLinks: AppointmentLink[],
  crews: Crew[],
  date: Date,
  dismissals: RForceDismissal[],
  mappings?: ResourceMapping[]
): RForceDisplayItem[] {
  const dateStr = format(date, "yyyy-MM-dd");

  const linksByExtKey = new Map<string, AppointmentLink>();
  for (const link of activeLinks) {
    if (!link.unlinked_at) linksByExtKey.set(link.external_key, link);
  }

  const apptsById = new Map<string, Appointment>();
  for (const a of appointments) {
    if (a.status !== "cancelled") apptsById.set(a.id, a);
  }

  const dismissalKeys = new Set<string>();
  for (const d of dismissals) {
    dismissalKeys.add(`${d.work_order_number}|${d.rforce_date}`);
  }

  const items: RForceDisplayItem[] = [];

  for (const rf of rforceOrders) {
    if (!rf.scheduled_start) continue;
    if (rf.wo_status === "Appt Complete / Closed" || rf.wo_status === "Canceled") continue;

    const startDate = rf.scheduled_start.slice(0, 10);
    const endDate = rf.scheduled_end ? rf.scheduled_end.slice(0, 10) : startDate;
    if (dateStr < startDate || dateStr > endDate) continue;

    const resourceName =
      rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
    if (!resourceName) continue;

    const crew = matchCrewByName(resourceName, crews, mappings);
    if (!crew) continue;

    const hour = parseInt(rf.scheduled_start.slice(11, 13), 10);
    const isMeasure = crew.crew_type === "measure_tech";
    const timeBlock: TimeBlock = isMeasure ? timeToBlock(hour) : "full_day";

    const link = linksByExtKey.get(rf.id);

    if (link) {
      const appt = apptsById.get(link.appointment_id);
      if (!appt) continue;

      const diffs = compareLinkedPair(appt, rf, crews, mappings);
      const displayMode: RForceDisplayMode = diffs ? "discrepancy" : "synced";
      items.push({
        rforceOrder: rf,
        crewId: crew.id,
        timeBlock,
        displayMode,
        linkedAppointment: appt,
        differences: diffs || undefined,
      });
    } else {
      const dismissKey = `${rf.work_order_number}|${startDate}`;
      if (dismissalKeys.has(dismissKey)) continue;

      items.push({
        rforceOrder: rf,
        crewId: crew.id,
        timeBlock,
        displayMode: "approval",
      });
    }
  }

  return items;
}
