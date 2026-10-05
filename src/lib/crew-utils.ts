import { Crew, CrewType, AppointmentType, Appointment, TimeBlock, AvailabilityRule, AvailabilityException } from "./types";
import { MEASURE_TIME_BLOCKS, getSpannedBlocks, timeBlockStartEnd } from "./calendar-utils";
import { crewWorksDate } from "./crew-days";
import { getCrewRoleForDate } from "./availability";

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

/**
 * The section a resource's own `crew_type` puts them in — their "home" desk.
 * Seconds and management sit outside the four main departments and return null.
 */
export function primarySectionFor(crew: Crew): string | null {
  switch (crew.crew_type) {
    case "measure_tech":
      return "measure";
    case "install_in_house":
    case "install_sub":
      return "install";
    case "svc":
      return "service";
    case "jip":
      return "jip";
    default:
      return null;
  }
}

/**
 * Should this crew be drawn in this section?
 *
 * Normally any section their types cover. With `primary_section_only` set they
 * are collapsed to the one section their `crew_type` names — the extra rows are
 * noise for people whose second department is occasional. The surviving row
 * still shows all of their work, so nothing is hidden by collapsing.
 */
function belongsInSection(crew: Crew, sectionKey: string): boolean {
  if (!crew.primary_section_only) return true;
  const home = primarySectionFor(crew);
  // A type roles don't cover (second / management) keeps its usual placement.
  if (!home) return true;
  return home === sectionKey;
}

export function getCrewDepartments(crews: Crew[]) {
  const active = crews.filter((c) => c.is_active);
  const main = active.filter((c) => !crewHasType(c, "misc", "second", "management"));
  const management = sortByFirstName(active.filter((c) => c.crew_type === "management"));
  const seconds = active.filter((c) => c.crew_type === "second");

  return {
    measure: sortByFirstName(
      main.filter((c) => crewHasType(c, "measure_tech") && belongsInSection(c, "measure"))
    ),
    install: sortByFirstName(
      main.filter(
        (c) =>
          crewHasType(c, "install_in_house", "install_sub") && belongsInSection(c, "install")
      )
    ),
    installSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && (primary.crew_type === "install_in_house" || primary.crew_type === "install_sub");
      })
    ),
    service: sortByFirstName(
      main.filter((c) => crewHasType(c, "svc") && belongsInSection(c, "service"))
    ),
    jip: sortByFirstName(
      main.filter((c) => crewHasType(c, "jip") && belongsInSection(c, "jip"))
    ),
    jipSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && primary.crew_type === "jip";
      })
    ),
    // Single consolidated management list — no duplicates
    management,
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
  if (d.install.length) sections.push({ key: "install", title: "Install", crews: d.install, filterType: "install" });
  if (d.installSeconds.length) sections.push({ key: "install-seconds", title: "Install Seconds", crews: d.installSeconds, filterType: "install" });
  if (d.service.length) sections.push({ key: "service", title: "Service", crews: d.service, filterType: "service" });
  if (d.jip.length) sections.push({ key: "jip", title: "JIP", crews: d.jip, filterType: "jip" });
  if (d.jipSeconds.length) sections.push({ key: "jip-seconds", title: "JIP Seconds", crews: d.jipSeconds, filterType: "jip" });
  // Single management section — each crew appears once, no duplicates
  if (d.management.length) sections.push({ key: "management", title: "Management", crews: d.management, filterType: "install" });

  return sections;
}

/** The four departments a role assignment can name. */
export const MAIN_DEPARTMENTS = ["measure", "install", "service", "jip"] as const;

export const DEPARTMENT_LABELS: Record<string, string> = {
  measure: "Measure",
  install: "Install",
  service: "Service",
  jip: "JIP",
};

export interface RoleBlock {
  /** The department this crew is assigned to on the date. */
  department: string;
  /** Short label for the blocked cell, e.g. "Service". */
  label: string;
}

/**
 * Is this crew's row in `sectionKey` blocked on `date` because a role
 * assignment puts them in another department that day?
 *
 * A dual-role resource gets a row in EVERY section their types cover, so a
 * measure scheduler can always see the whole person. A `role_assignment` rule
 * ("SVC Mon–Wed, MT Thu–Fri") no longer moves that row between sections — it
 * reserves the person for one department per day and blocks the others, so the
 * off-role sections show where they went instead of silently dropping them.
 *
 * Returns null when the row is live: no rule that day, a rule naming this very
 * section, or a section (seconds / management) that roles don't apply to.
 */
export function getCrewRoleBlock(
  crew: Crew,
  sectionKey: string,
  date: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): RoleBlock | null {
  if (!(MAIN_DEPARTMENTS as readonly string[]).includes(sectionKey)) return null;
  // A collapsed resource has only the one row, so there is nothing to block —
  // blocking it would hide their whole day. Their role shows as a day tag
  // instead (see getCrewRoleTag).
  if (crew.primary_section_only) return null;
  const role = getCrewRoleForDate(crew.id, date, rules, exceptions);
  if (!role) return null;
  if (role === sectionKey) return null;
  return { department: role, label: DEPARTMENT_LABELS[role] || role };
}

/** Compact department tags for the day-tag strip, e.g. "SVC". */
const DEPARTMENT_SHORT: Record<string, string> = {
  measure: "MT",
  install: "INS",
  service: "SVC",
  jip: "JIP",
};

/**
 * The short department tag for a collapsed resource on a given date.
 *
 * A resource with `primary_section_only` keeps one row wherever their role
 * rules say they are, so the rules can't move or block anything. This is what
 * is left of them: a small marker telling the scheduler which department the
 * person is on that day. Returns null for anyone not collapsed, or on a day no
 * rule covers.
 */
export function getCrewRoleTag(
  crew: Crew,
  date: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): string | null {
  if (!crew.primary_section_only) return null;
  const role = getCrewRoleForDate(crew.id, date, rules, exceptions);
  if (!role) return null;
  return DEPARTMENT_SHORT[role] || role.toUpperCase();
}

/**
 * The section a given kind of work belongs to. Job site visits are universal —
 * anyone can do one — so they are never foreign to the section they appear in.
 */
const APPOINTMENT_HOME_SECTION: Record<AppointmentType, string | null> = {
  tech_measure: "measure",
  install: "install",
  lswp: "install",
  hoa: "install",
  paint_stain: "install",
  service: "service",
  jip: "jip",
  job_site_visit: null,
};

const SECTION_FOR_FILTER_TYPE: Record<string, string> = {
  tech_measure: "measure",
  install: "install",
  service: "service",
  jip: "jip",
};

/**
 * Is this appointment out-of-department for the section it is being drawn in?
 *
 * A dual-role resource's measure row shows their service and JIP work too, so
 * the grid can tell the scheduler the slot is genuinely taken. Those tiles are
 * drawn in a neutral "not this department" style rather than the crew color.
 */
export function isForeignToSection(
  appointment: Appointment,
  sectionKeyOrFilterType: string
): boolean {
  const home = APPOINTMENT_HOME_SECTION[appointment.appointment_type];
  if (!home) return false;
  const section =
    SECTION_FOR_FILTER_TYPE[sectionKeyOrFilterType] || sectionKeyOrFilterType;
  if (!(MAIN_DEPARTMENTS as readonly string[]).includes(section)) return false;
  return home !== section;
}

/** Short badge text for a foreign tile, e.g. "SVC". */
export function foreignTypeBadge(appointment: Appointment): string {
  switch (appointment.appointment_type) {
    case "tech_measure":
      return "MT";
    case "service":
      return "SVC";
    case "jip":
      return "JIP";
    case "lswp":
      return "LSWP";
    case "hoa":
      return "HOA";
    case "paint_stain":
      return "PNT";
    case "job_site_visit":
      return "JSV";
    default:
      return "INS";
  }
}

const ELIGIBLE_CREW_TYPES: Record<AppointmentType, CrewType[]> = {
  tech_measure: ["measure_tech"],
  install: ["install_in_house", "install_sub", "jip"],
  service: ["svc"],
  jip: ["jip"],
  lswp: ["install_in_house", "install_sub"],
  hoa: ["install_in_house", "install_sub"],
  paint_stain: ["install_in_house", "install_sub"],
  // Job Site Visits are universal — anyone can do one, no crew-type restriction.
  // An empty list means every active crew is eligible.
  job_site_visit: [],
};

export function getEligibleCrews(crews: Crew[], appointmentType: AppointmentType): Crew[] {
  const eligible = ELIGIBLE_CREW_TYPES[appointmentType] || [];
  return crews.filter(
    (c) =>
      c.is_active &&
      (eligible.length === 0 ||
        // Managers cover any role, so they're eligible for every appointment
        // type. This must match the flag engine (flags.ts), which likewise
        // treats management as universally eligible — otherwise creating an
        // appointment succeeds but editing it later fails validation.
        c.crew_type === "management" ||
        crewHasType(c, ...eligible)),
  );
}

export function getBlockedTimeBlocks(
  crewId: string,
  appointments: Appointment[],
  dateStr: string
): Set<TimeBlock> {
  const blocked = new Set<TimeBlock>();

  // Every appointment that puts THIS crew on THIS date — including multi-day
  // jobs that started earlier, and excluding days a partial helper doesn't work.
  const dayAppts = appointments.filter((a) => {
    if (a.status === "cancelled" || a.status === "unscheduled") return false;
    return crewWorksDate(a, crewId, dateStr);
  });

  for (const appt of dayAppts) {
    if (appt.is_full_day || appt.time_block === "full_day") {
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
    } else if (appt.start_time && appt.end_time) {
      // Timed work (service/JIP/…) blocks only the measure blocks its window
      // touches. Treating any block-less job as all-day let a 1-hour service
      // grey out a dual-role crew's whole measure lane for the day.
      const start = appt.start_time.slice(0, 5);
      const end = appt.end_time.slice(0, 5);
      for (const b of MEASURE_TIME_BLOCKS) {
        const win = timeBlockStartEnd(b);
        if (start < win.end && end > win.start) blocked.add(b);
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
