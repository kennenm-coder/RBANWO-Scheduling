import { Crew, CrewType, AppointmentType, Appointment, TimeBlock } from "./types";
import { MEASURE_TIME_BLOCKS, getSpannedBlocks } from "./calendar-utils";
import { addDays, parseISO } from "date-fns";

export function crewHasType(crew: Crew, ...types: CrewType[]): boolean {
  if (types.includes(crew.crew_type)) return true;
  if (crew.additional_types) {
    return crew.additional_types.some((t) => types.includes(t));
  }
  return false;
}

export function isDualRole(crew: Crew): boolean {
  if (!crew.additional_types || crew.additional_types.length === 0) return false;
  const allTypes = [crew.crew_type, ...crew.additional_types];
  const mainTypes = allTypes.filter((t) => t !== "second" && t !== "management" && t !== "misc");
  return mainTypes.length > 1;
}

export function sortByFirstName(crews: Crew[]): Crew[] {
  return [...crews].sort((a, b) => {
    const aFirst = a.name.split(" ")[0].toLowerCase();
    const bFirst = b.name.split(" ")[0].toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function parseCity(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2] || parts[0];
  }
  const words = address.split(" ");
  if (words.length >= 3) {
    const stateZipPattern = /^[A-Z]{2}$/;
    const zipPattern = /^\d{5}/;
    for (let i = words.length - 1; i >= 1; i--) {
      if (stateZipPattern.test(words[i]) || zipPattern.test(words[i])) continue;
      return words[i];
    }
  }
  return address;
}

export function getCrewDepartments(crews: Crew[]) {
  const active = crews.filter((c) => c.is_active);
  const main = active.filter((c) => !crewHasType(c, "misc", "second", "management"));
  const management = active.filter((c) => c.crew_type === "management");
  const seconds = active.filter((c) => c.crew_type === "second");

  return {
    measure: sortByFirstName(main.filter((c) => crewHasType(c, "measure_tech"))),
    measureManagement: sortByFirstName(management.filter((c) => c.manages?.includes("measure"))),
    install: sortByFirstName(main.filter((c) => crewHasType(c, "install_in_house", "install_sub"))),
    installSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && (primary.crew_type === "install_in_house" || primary.crew_type === "install_sub");
      })
    ),
    installManagement: sortByFirstName(management.filter((c) => c.manages?.includes("install"))),
    service: sortByFirstName(main.filter((c) => crewHasType(c, "svc"))),
    serviceManagement: sortByFirstName(management.filter((c) => c.manages?.includes("service"))),
    jip: sortByFirstName(main.filter((c) => crewHasType(c, "jip"))),
    jipSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && primary.crew_type === "jip";
      })
    ),
    jipManagement: sortByFirstName(management.filter((c) => c.manages?.includes("jip"))),
  };
}

export interface DepartmentSection {
  key: string;
  title: string;
  crews: Crew[];
  filterType: "tech_measure" | "install" | "service" | "jip";
}

export function getDepartmentSections(crews: Crew[]): DepartmentSection[] {
  const d = getCrewDepartments(crews);
  const sections: DepartmentSection[] = [];

  if (d.measure.length) sections.push({ key: "measure", title: "Measure Techs", crews: d.measure, filterType: "tech_measure" });
  if (d.measureManagement.length) sections.push({ key: "measure-mgmt", title: "Measure Management", crews: d.measureManagement, filterType: "tech_measure" });
  if (d.installManagement.length) sections.push({ key: "install-mgmt", title: "Install Management", crews: d.installManagement, filterType: "install" });
  if (d.install.length) sections.push({ key: "install", title: "Install", crews: d.install, filterType: "install" });
  if (d.installSeconds.length) sections.push({ key: "install-seconds", title: "Install Seconds", crews: d.installSeconds, filterType: "install" });
  if (d.service.length) sections.push({ key: "service", title: "Service", crews: d.service, filterType: "service" });
  if (d.serviceManagement.length) sections.push({ key: "service-mgmt", title: "Service Management", crews: d.serviceManagement, filterType: "service" });
  if (d.jip.length) sections.push({ key: "jip", title: "JIP", crews: d.jip, filterType: "jip" });
  if (d.jipSeconds.length) sections.push({ key: "jip-seconds", title: "JIP Seconds", crews: d.jipSeconds, filterType: "jip" });
  if (d.jipManagement.length) sections.push({ key: "jip-mgmt", title: "JIP Management", crews: d.jipManagement, filterType: "jip" });

  return sections;
}

const ELIGIBLE_CREW_TYPES: Record<AppointmentType, CrewType[]> = {
  tech_measure: ["measure_tech"],
  install: ["install_in_house", "install_sub", "jip"],
  service: ["svc"],
  jip: ["jip"],
  lswp: ["install_in_house", "install_sub"],
  hoa: ["install_in_house", "install_sub"],
  paint_stain: ["install_in_house", "install_sub"],
};

export function getEligibleCrews(crews: Crew[], appointmentType: AppointmentType): Crew[] {
  const eligible = ELIGIBLE_CREW_TYPES[appointmentType] || [];
  return crews.filter(
    (c) => c.is_active && (eligible.length === 0 || crewHasType(c, ...eligible))
  );
}

export function getBlockedTimeBlocks(
  crewId: string,
  appointments: Appointment[],
  dateStr: string
): Set<TimeBlock> {
  const blocked = new Set<TimeBlock>();
  const targetDate = parseISO(dateStr);

  // Find all appointments for this crew that overlap the target date,
  // including multi-day appointments that started on an earlier date.
  const dayAppts = appointments.filter((a) => {
    if (a.status === "cancelled" || a.status === "unscheduled") return false;
    if (!(a.crew_id === crewId || a.secondary_crew_id === crewId || a.tertiary_crew_id === crewId)) return false;
    if (!a.scheduled_date) return false;

    // Direct date match
    if (a.scheduled_date === dateStr) return true;

    // Multi-day: check if target date falls within the appointment's span
    if (a.duration_days > 1) {
      const start = parseISO(a.scheduled_date);
      for (let d = 1; d < a.duration_days; d++) {
        const spanned = addDays(start, d);
        if (spanned.getFullYear() === targetDate.getFullYear() &&
            spanned.getMonth() === targetDate.getMonth() &&
            spanned.getDate() === targetDate.getDate()) {
          return true;
        }
      }
    }
    return false;
  });

  for (const appt of dayAppts) {
    if (appt.time_block === "full_day") {
      // Full-day blocks everything
      blocked.add("full_day");
      for (const b of MEASURE_TIME_BLOCKS) {
        blocked.add(b);
      }
    } else if (appt.time_block) {
      // Account for multi-block spans (time_block to time_block_end)
      const spanned = getSpannedBlocks(appt);
      for (const b of spanned) {
        blocked.add(b);
      }
    } else if (!appt.time_block && appt.appointment_type !== "tech_measure") {
      // Non-measure appointment without a block = treat as full day
      for (const b of MEASURE_TIME_BLOCKS) {
        blocked.add(b);
      }
    }
  }

  return blocked;
}

export function getAvailableTimeBlocks(
  crewId: string,
  appointments: Appointment[],
  dateStr: string
): TimeBlock[] {
  const blocked = getBlockedTimeBlocks(crewId, appointments, dateStr);
  return MEASURE_TIME_BLOCKS.filter((b) => !blocked.has(b));
}
