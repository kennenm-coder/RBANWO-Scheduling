/**
 * Three-class flag detection engine.
 *
 * Class 1 — Live app issues: auto-clear when the condition becomes false.
 *   No checkbox. Recalculate after every mutation.
 *
 * Class 2 — External confirmation: app vs. rForce snapshot mismatch.
 *   Checkbox means "I updated rForce; waiting for import."
 *   Auto-resolve when next import confirms match; reopen if mismatch remains.
 *
 * Class 3 — Workflow / data-integrity: requires a specific action (link, map, fix).
 *   Some auto-clear (linking), some use waiting-for-import.
 */

import {
  Appointment,
  AppointmentLink,
  AvailabilityRule,
  AvailabilityException,
  Crew,
  RForceOrder,
  ResourceMapping,
  TimeOffRequest,
  SchedulingFlag,
  FlagClass,
  FlagCode,
  FlagSeverity,
  FlagFingerprint,
  FlagDifferences,
} from "./types";
import { getTimeOffForDate } from "./store";
import {
  normalizeWoType,
  extractHour,
  CANCELLED_STATUSES,
  getRForceResource,
  timeBlockMatchesHour,
} from "./normalize";
import { checkSchedulingConflicts } from "./scheduling-validation";
import { getCrewAvailability } from "./availability";
import { parseISO } from "date-fns";

/** Build a stable fingerprint string for deduplication and resolution matching. */
function buildFingerprintId(fp: FlagFingerprint): string {
  const parts = [
    fp.appointmentId || "_",
    fp.workOrderNumber || "_",
    fp.flagCode,
    fp.affectedField || "_",
    fp.appValue || "_",
    fp.importedValue || "_",
  ];
  return parts.join("|");
}

function makeFlag(
  flagClass: FlagClass,
  code: FlagCode,
  severity: FlagSeverity,
  message: string,
  resolution: string,
  fingerprint: FlagFingerprint,
  extra?: Partial<SchedulingFlag>
): SchedulingFlag {
  const autoClears = flagClass === "live_app";
  const canAcknowledge = flagClass === "external_confirmation" ||
    (flagClass === "workflow" && (code === "unmapped_resource" || code === "source_record_missing"));

  return {
    id: buildFingerprintId(fingerprint),
    fingerprint,
    flagClass,
    state: "open",
    code,
    severity,
    message,
    resolution,
    autoClears,
    canAcknowledge,
    ...extra,
  };
}

// ── Class 1: Live App Issues ──

function detectLiveAppFlags(
  appointments: Appointment[],
  crews: Crew[],
  timeOffRequests: TimeOffRequest[],
  availabilityRules?: AvailabilityRule[],
  availabilityExceptions?: AvailabilityException[]
): SchedulingFlag[] {
  const flags: SchedulingFlag[] = [];
  const active = appointments.filter(
    (a) => a.status !== "cancelled" && a.status !== "unscheduled"
  );

  for (const appt of active) {
    if (!appt.scheduled_date || !appt.crew_id) {
      // Missing scheduling fields
      if (!appt.crew_id) {
        flags.push(
          makeFlag("live_app", "missing_crew", "error",
            `${appt.customer_name}: no crew assigned`,
            "Assign a crew to this appointment.",
            { appointmentId: appt.id, flagCode: "missing_crew" },
            { appointmentId: appt.id, date: appt.scheduled_date || undefined })
        );
      }
      if (!appt.scheduled_date) {
        flags.push(
          makeFlag("live_app", "missing_scheduled_date", "error",
            `${appt.customer_name}: no scheduled date`,
            "Set a scheduled date or unschedule the appointment.",
            { appointmentId: appt.id, flagCode: "missing_scheduled_date" },
            { appointmentId: appt.id })
        );
      }
      continue; // Can't check further without crew + date
    }

    const crew = crews.find((c) => c.id === appt.crew_id);
    const crewName = crew?.name || "Unknown";

    // ── Time-off conflict ──
    const offToday = getTimeOffForDate(timeOffRequests, appt.scheduled_date);
    const isOff = offToday.some((r) => {
      const torFirst = r.employee_name.split(" ")[0].toLowerCase();
      const crewFirst = crewName.split(" ")[0].toLowerCase();
      const torLast = r.employee_name.split(" ").slice(-1)[0].toLowerCase();
      const crewLast = crewName.split(" ").slice(-1)[0].toLowerCase();
      return crewFirst === torFirst && crewLast.slice(0, 4) === torLast.slice(0, 4);
    });
    if (isOff) {
      flags.push(
        makeFlag("live_app", "time_off_conflict", "error",
          `${crewName} has time off on ${appt.scheduled_date} but is scheduled for ${appt.customer_name}`,
          "Move the appointment to a different date or crew.",
          { appointmentId: appt.id, flagCode: "time_off_conflict" },
          { appointmentId: appt.id, crewId: appt.crew_id, date: appt.scheduled_date })
      );
    }

    // ── Double booking (covers multi-day, multi-block, and full-day conflicts) ──
    if (appt.time_block && appt.scheduled_date) {
      const conflicts = checkSchedulingConflicts(
        appt.crew_id,
        appt.scheduled_date,
        appt.duration_days,
        appt.time_block,
        appt.time_block_end,
        active,
        appt.id
      );
      for (const conflict of conflicts) {
        // Only flag once per pair: the appointment with the lower ID reports it
        if (appt.id > conflict.conflictingAppointmentId) continue;

        const reasonLabel = conflict.reason === "multi_day_overlap"
          ? "multi-day overlap" : conflict.reason === "multi_block_overlap"
          ? "multi-block overlap" : conflict.reason === "full_day_conflict"
          ? "full-day conflict" : `${conflict.conflictBlock} block`;

        flags.push(
          makeFlag("live_app", "double_booking", "error",
            `${crewName} is double-booked on ${conflict.conflictDate} (${reasonLabel}) — conflicts with ${conflict.customerName}`,
            "Move or cancel one of the conflicting appointments.",
            {
              appointmentId: appt.id, flagCode: "double_booking",
              affectedField: "time_block",
              appValue: `${appt.crew_id}|${conflict.conflictDate}|${conflict.conflictBlock}`,
            },
            { appointmentId: appt.id, crewId: appt.crew_id, date: conflict.conflictDate })
        );
      }
    }

    // ── Invalid resource type (crew type doesn't match appointment type) ──
    if (crew) {
      // Which crew types can handle each appointment type.
      // "management" is eligible for everything (managers cover any role).
      // Cross-eligibility reflects real-world scheduling patterns:
      //   - JIP crews also handle service
      //   - Service crews also handle installs
      //   - Install crews also handle service
      const MANAGEMENT = "management";
      const ELIGIBLE: Record<string, string[]> = {
        tech_measure: ["measure_tech", MANAGEMENT],
        install: ["install_in_house", "install_sub", "jip", "svc", MANAGEMENT],
        service: ["svc", "jip", "install_in_house", "install_sub", MANAGEMENT],
        jip: ["jip", MANAGEMENT],
        lswp: ["install_in_house", "install_sub", MANAGEMENT],
        hoa: ["install_in_house", "install_sub", MANAGEMENT],
        paint_stain: ["install_in_house", "install_sub", MANAGEMENT],
        // Job Site Visits are universal — anyone can do one. Empty = no restriction.
        job_site_visit: [],
      };
      const eligible = ELIGIBLE[appt.appointment_type] || [];
      const allCrewTypes = [crew.crew_type, ...(crew.additional_types || [])];
      const isEligible = eligible.length === 0 || eligible.some((t) => allCrewTypes.includes(t as typeof allCrewTypes[number]));
      if (!isEligible) {
        flags.push(
          makeFlag("live_app", "invalid_resource_type", "warning",
            `${crewName} (${crew.crew_type}) is not eligible for ${appt.appointment_type} appointments`,
            "Reassign to an eligible crew.",
            { appointmentId: appt.id, flagCode: "invalid_resource_type", affectedField: "crew_type", appValue: crew.crew_type },
            { appointmentId: appt.id, crewId: appt.crew_id, date: appt.scheduled_date })
        );
      }
    }

    // ── Missing time block (scheduled but no time block) ──
    if (!appt.time_block) {
      flags.push(
        makeFlag("live_app", "missing_time", "warning",
          `${appt.customer_name} on ${appt.scheduled_date}: no time block assigned`,
          "Set a time block for this appointment.",
          { appointmentId: appt.id, flagCode: "missing_time" },
          { appointmentId: appt.id, date: appt.scheduled_date })
      );
    }

    // ── Missing address ──
    if (!appt.address || appt.address.trim().length < 5) {
      flags.push(
        makeFlag("live_app", "missing_address", "warning",
          `${appt.customer_name} on ${appt.scheduled_date}: no valid address`,
          "Add or correct the address.",
          { appointmentId: appt.id, flagCode: "missing_address" },
          { appointmentId: appt.id, date: appt.scheduled_date })
      );
    }

    // ── Availability conflict (crew scheduled during PTO/block rule) ──
    // Skipped when the scheduler knowingly booked over the block (override flow).
    if (availabilityRules && availabilityRules.length > 0 && appt.time_block && !appt.allow_availability_conflict) {
      const date = parseISO(appt.scheduled_date);
      const dayAvail = getCrewAvailability(
        appt.crew_id,
        date,
        availabilityRules,
        availabilityExceptions || []
      );
      if (!dayAvail.available) {
        flags.push(
          makeFlag("live_app", "availability_conflict", "error",
            `${crewName} is ${dayAvail.reason || "unavailable"} on ${appt.scheduled_date} but is scheduled for ${appt.customer_name}`,
            "Move the appointment to a different date or crew.",
            { appointmentId: appt.id, flagCode: "availability_conflict" },
            { appointmentId: appt.id, crewId: appt.crew_id, date: appt.scheduled_date })
        );
      } else if (dayAvail.unavailableBlocks.has(appt.time_block)) {
        flags.push(
          makeFlag("live_app", "availability_conflict", "warning",
            `${crewName} is unavailable during ${appt.time_block} on ${appt.scheduled_date} but is scheduled for ${appt.customer_name}`,
            "Move the appointment to an available time block.",
            {
              appointmentId: appt.id, flagCode: "availability_conflict",
              affectedField: "time_block", appValue: appt.time_block,
            },
            { appointmentId: appt.id, crewId: appt.crew_id, date: appt.scheduled_date })
        );
      }
    }
  }

  // ── Duplicate app appointments (same WO# on multiple active appointments) ──
  const woToAppts = new Map<string, Appointment[]>();
  for (const appt of active) {
    if (!appt.work_order_number) continue;
    const existing = woToAppts.get(appt.work_order_number) || [];
    existing.push(appt);
    woToAppts.set(appt.work_order_number, existing);
  }
  for (const [wo, appts] of woToAppts) {
    if (appts.length <= 1) continue;
    // Flag only the first one (to avoid N duplicate flags)
    flags.push(
      makeFlag("live_app", "duplicate_app_appointment", "warning",
        `Work order ${wo} appears on ${appts.length} active appointments`,
        "Cancel or merge the duplicate appointments.",
        {
          appointmentId: appts[0].id, flagCode: "duplicate_app_appointment",
          workOrderNumber: wo,
        },
        { appointmentId: appts[0].id, workOrderNumber: wo })
    );
  }

  return flags;
}

// ── Class 2: External Confirmation Issues ──

function detectExternalFlags(
  appointments: Appointment[],
  crews: Crew[],
  rforceOrders: RForceOrder[]
): SchedulingFlag[] {
  const flags: SchedulingFlag[] = [];
  const active = appointments.filter(
    (a) => a.status !== "cancelled" && a.status !== "unscheduled"
  );

  // ── rForce cancelled but app appointment still active ──
  for (const rf of rforceOrders) {
    if (!CANCELLED_STATUSES.has(rf.wo_status || "") && !CANCELLED_STATUSES.has(rf.order_status || "")) continue;
    const linked = active.find(
      (a) => a.work_order_number === rf.work_order_number
    );
    if (!linked) continue;
    flags.push(
      makeFlag("live_app", "rforce_cancellation_mismatch", "error",
        `${rf.customer_name || rf.work_order_number}: rForce says cancelled but appointment is still active`,
        "Cancel or remove this appointment — the rForce work order was cancelled.",
        {
          appointmentId: linked.id,
          workOrderNumber: rf.work_order_number,
          flagCode: "rforce_cancellation_mismatch",
        },
        { appointmentId: linked.id, crewId: linked.crew_id || undefined, date: linked.scheduled_date || undefined, workOrderNumber: rf.work_order_number })
    );
  }

  // ── Data mismatches between linked pairs ──
  for (const rf of rforceOrders) {
    if (!rf.scheduled_start) continue;
    if (CANCELLED_STATUSES.has(rf.wo_status || "") || CANCELLED_STATUSES.has(rf.order_status || "")) continue; // already handled above
    const rfDate = rf.scheduled_start.slice(0, 10);
    const linked = active.find(
      (a) => a.work_order_number === rf.work_order_number
    );
    if (!linked || !linked.scheduled_date || !linked.crew_id) continue;

    const rfResource = getRForceResource(rf);
    const linkedCrew = crews.find((c) => c.id === linked.crew_id);
    const linkedCrewName = linkedCrew?.name;

    const diffs: FlagDifferences = {};

    // ── Date mismatch ──
    const dateMismatch = linked.scheduled_date !== rfDate;
    if (dateMismatch) {
      diffs.date = { app: linked.scheduled_date, rforce: rfDate };
    }

    // ── Crew mismatch (first-name comparison) ──
    const crewMatch = rfResource && linkedCrewName
      ? linkedCrewName.toLowerCase().split(" ")[0] === rfResource.toLowerCase().split(" ")[0]
      : true;
    const crewMismatch = !crewMatch;
    if (crewMismatch && rfResource) {
      diffs.crew = { app: linkedCrewName || "unassigned", rforce: rfResource };
    }

    // ── Time mismatch (using block-range tolerance) ──
    const rforceTime = rf.scheduled_start.slice(11, 16);
    const rforceHour = extractHour(rf.scheduled_start);
    const appStartTime = linked.start_time;
    const appTimeBlock = linked.time_block;
    // Use block-range tolerance: e.g. 4:30 PM rForce falls within app's "4-6" block
    const timeMismatch = rforceHour !== null && appTimeBlock
      ? !timeBlockMatchesHour(appTimeBlock, rforceHour)
      : false;
    if (timeMismatch) {
      diffs.time = {
        app: appStartTime || appTimeBlock || "none",
        rforce: rforceTime || `hour ${rforceHour}`,
      };
    }

    // ── Type mismatch (uses full normalizer including LSWP, HOA, Paint/Stain) ──
    const rfTypeMapped = normalizeWoType(rf.work_order_type);
    const typeMismatch = rfTypeMapped !== null && rfTypeMapped !== linked.appointment_type;
    if (typeMismatch) {
      diffs.type = { app: linked.appointment_type, rforce: rf.work_order_type || "unknown" };
    }

    const isOverride = !!linked.manual_override;

    // Emit one flag per mismatch field for granular tracking
    if (dateMismatch) {
      flags.push(
        makeFlag("external_confirmation",
          isOverride ? "manual_override_active" : "date_mismatch",
          isOverride ? "info" : "warning",
          `${rf.customer_name || rf.work_order_number}: date differs — app ${linked.scheduled_date}, rForce ${rfDate}`,
          isOverride
            ? "Manual override active. Verify rForce is updated."
            : "Update rForce to match the app date, or correct the app appointment.",
          {
            appointmentId: linked.id,
            workOrderNumber: rf.work_order_number,
            flagCode: isOverride ? "manual_override_active" : "date_mismatch",
            affectedField: "date",
            appValue: linked.scheduled_date,
            importedValue: rfDate,
          },
          { appointmentId: linked.id, crewId: linked.crew_id, date: linked.scheduled_date, workOrderNumber: rf.work_order_number, differences: diffs })
      );
    }

    if (crewMismatch && rfResource) {
      flags.push(
        makeFlag("external_confirmation",
          isOverride ? "manual_override_active" : "resource_mismatch",
          isOverride ? "info" : "warning",
          `${rf.customer_name || rf.work_order_number}: crew differs — app ${linkedCrewName || "unassigned"}, rForce ${rfResource}`,
          isOverride
            ? "Manual override active. Verify rForce is updated."
            : "Update rForce to match the app crew, or correct the app appointment.",
          {
            appointmentId: linked.id,
            workOrderNumber: rf.work_order_number,
            flagCode: isOverride ? "manual_override_active" : "resource_mismatch",
            affectedField: "crew",
            appValue: linkedCrewName || "unassigned",
            importedValue: rfResource,
          },
          { appointmentId: linked.id, crewId: linked.crew_id, date: linked.scheduled_date, workOrderNumber: rf.work_order_number, differences: diffs })
      );
    }

    if (timeMismatch) {
      flags.push(
        makeFlag("external_confirmation",
          isOverride ? "manual_override_active" : "time_mismatch",
          isOverride ? "info" : "warning",
          `${rf.customer_name || rf.work_order_number}: time differs — app ${appStartTime || appTimeBlock || "?"}, rForce ${rforceTime || `hour ${rforceHour}`}`,
          isOverride
            ? "Manual override active. Verify rForce is updated."
            : "Update rForce to match the app time, or correct the app appointment.",
          {
            appointmentId: linked.id,
            workOrderNumber: rf.work_order_number,
            flagCode: isOverride ? "manual_override_active" : "time_mismatch",
            affectedField: "time",
            appValue: appStartTime || appTimeBlock || "none",
            importedValue: rforceTime || `hour ${rforceHour}`,
          },
          { appointmentId: linked.id, crewId: linked.crew_id, date: linked.scheduled_date, workOrderNumber: rf.work_order_number, differences: diffs })
      );
    }

    if (typeMismatch) {
      flags.push(
        makeFlag("external_confirmation",
          isOverride ? "manual_override_active" : "type_mismatch",
          isOverride ? "info" : "warning",
          `${rf.customer_name || rf.work_order_number}: type differs — app ${linked.appointment_type}, rForce ${rf.work_order_type}`,
          isOverride
            ? "Manual override active. Verify rForce is updated."
            : "Update rForce to match the app type, or correct the app appointment.",
          {
            appointmentId: linked.id,
            workOrderNumber: rf.work_order_number,
            flagCode: isOverride ? "manual_override_active" : "type_mismatch",
            affectedField: "type",
            appValue: linked.appointment_type,
            importedValue: rf.work_order_type || "unknown",
          },
          { appointmentId: linked.id, crewId: linked.crew_id, date: linked.scheduled_date, workOrderNumber: rf.work_order_number, differences: diffs })
      );
    }
  }

  return flags;
}

// ── Class 3: Workflow / Data-Integrity Issues ──

function detectWorkflowFlags(
  appointments: Appointment[],
  activeLinks: AppointmentLink[]
): SchedulingFlag[] {
  const flags: SchedulingFlag[] = [];
  const active = appointments.filter(
    (a) => a.status !== "cancelled" && a.status !== "unscheduled"
  );

  if (!activeLinks) return flags;

  // Index active links by appointment_id
  const linksByAppt = new Map<string, AppointmentLink[]>();
  for (const link of activeLinks) {
    if (link.unlinked_at) continue;
    const existing = linksByAppt.get(link.appointment_id) || [];
    existing.push(link);
    linksByAppt.set(link.appointment_id, existing);
  }

  for (const appt of active) {
    const links = linksByAppt.get(appt.id) || [];

    // ── Unlinked appointment ──
    if (links.length === 0) {
      flags.push(
        makeFlag("workflow", "unlinked_appointment", "info",
          `${appt.customer_name} on ${appt.scheduled_date || "unscheduled"}: not linked to an rForce work order`,
          "Link this appointment to an rForce work order.",
          { appointmentId: appt.id, flagCode: "unlinked_appointment" },
          { appointmentId: appt.id, date: appt.scheduled_date || undefined })
      );
    }

    // ── Duplicate links ──
    if (links.length > 1) {
      flags.push(
        makeFlag("workflow", "duplicate_link", "warning",
          `${appt.customer_name}: linked to ${links.length} rForce records`,
          "Remove the incorrect link(s).",
          { appointmentId: appt.id, flagCode: "duplicate_link" },
          { appointmentId: appt.id, date: appt.scheduled_date || undefined })
      );
    }
  }

  return flags;
}

// ── Main detection function ──

/**
 * Detect all scheduling flags across the three classes.
 *
 * Returns flags sorted by severity (error → warning → info),
 * then by class (live_app → external → workflow).
 */
export function detectFlags(
  appointments: Appointment[],
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[],
  activeLinks?: AppointmentLink[],
  availabilityRules?: AvailabilityRule[],
  availabilityExceptions?: AvailabilityException[],
  _resourceMappings?: ResourceMapping[]
): SchedulingFlag[] {
  const liveFlags = detectLiveAppFlags(appointments, crews, timeOffRequests, availabilityRules, availabilityExceptions);
  const externalFlags = detectExternalFlags(appointments, crews, rforceOrders);
  const workflowFlags = activeLinks
    ? detectWorkflowFlags(appointments, activeLinks)
    : [];

  const all = [...liveFlags, ...externalFlags, ...workflowFlags];

  // Sort: severity first, then class
  const sevOrder: Record<FlagSeverity, number> = { error: 0, warning: 1, info: 2 };
  const classOrder: Record<FlagClass, number> = { live_app: 0, external_confirmation: 1, workflow: 2 };

  all.sort((a, b) => {
    const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return classOrder[a.flagClass] - classOrder[b.flagClass];
  });

  return all;
}

// ── Lifecycle helpers ──

/**
 * Apply flag resolutions to detected flags, producing the correct state.
 *
 * - Live app flags: never change state from "open" (they auto-clear by not being detected)
 * - External confirmation flags with a matching resolution: state = "waiting_for_import"
 * - Workflow flags with a matching resolution: state = "waiting_for_import" (if canAcknowledge)
 */
export function applyResolutions(
  flags: SchedulingFlag[],
  resolvedKeys: Set<string>
): SchedulingFlag[] {
  return flags.map((flag) => {
    if (flag.autoClears) return flag; // Live flags don't get checkboxes
    if (resolvedKeys.has(flag.id)) {
      return { ...flag, state: "waiting_for_import" as const };
    }
    return flag;
  });
}

/**
 * Categorize flags into sections for the Issue Center UI.
 */
export function categorizeFlags(flags: SchedulingFlag[]): {
  actionRequired: SchedulingFlag[];
  updateRForce: SchedulingFlag[];
  waitingForImport: SchedulingFlag[];
  resolved: SchedulingFlag[];
} {
  const actionRequired: SchedulingFlag[] = [];
  const updateRForce: SchedulingFlag[] = [];
  const waitingForImport: SchedulingFlag[] = [];
  const resolved: SchedulingFlag[] = [];

  for (const flag of flags) {
    switch (flag.state) {
      case "waiting_for_import":
        waitingForImport.push(flag);
        break;
      case "resolved":
        resolved.push(flag);
        break;
      default: // open
        if (flag.flagClass === "live_app" || flag.flagClass === "workflow") {
          actionRequired.push(flag);
        } else {
          updateRForce.push(flag);
        }
    }
  }

  return { actionRequired, updateRForce, waitingForImport, resolved };
}

/**
 * Count flags that represent active scheduler work (for badge counts).
 * Excludes waiting_for_import and resolved flags.
 * Excludes info-severity flags (unlinked, overrides) from the count.
 */
export function countActionableFlags(flags: SchedulingFlag[]): number {
  return flags.filter(
    (f) => f.state === "open" && f.severity !== "info"
  ).length;
}

// Re-export for backward compatibility and convenience
export type { FlagDifferences, SchedulingFlag } from "./types";
export type Flag = SchedulingFlag;
