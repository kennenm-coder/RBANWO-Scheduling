import { Appointment, Crew, TimeOffRequest } from "./types";
import { parseISO, differenceInWeeks } from "date-fns";
import { getTimeOffForDate } from "./store";

interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateAppointment(
  appointment: Partial<Appointment> & { id?: string },
  existingForDay: Appointment[],
  crew: Crew,
  allCrews: Crew[],
  timeOffRequests?: TimeOffRequest[]
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const otherAppts = existingForDay.filter(
    (a) => a.status !== "cancelled" && a.id !== appointment.id
  );

  if (appointment.scheduled_date && timeOffRequests) {
    const offToday = getTimeOffForDate(timeOffRequests, appointment.scheduled_date);
    const crewMatch = offToday.find((r) => {
      const torFirst = r.employee_name.split(" ")[0].toLowerCase();
      const crewFirst = crew.name.split(" ")[0].toLowerCase();
      const torLast = r.employee_name.split(" ").slice(-1)[0].toLowerCase();
      const crewLast = crew.name.split(" ").slice(-1)[0].toLowerCase();
      return crewFirst === torFirst && crewLast.slice(0, 4) === torLast.slice(0, 4);
    });
    if (crewMatch) {
      warnings.push(`${crew.name} has time off scheduled this day`);
    }
  }

  if (appointment.appointment_type === "tech_measure") {
    const crewAppts = otherAppts.filter((a) => a.crew_id === crew.id);
    if (crewAppts.length >= 4) {
      warnings.push(
        `${crew.name} already has ${crewAppts.length} appointments this day (max recommended: 3-4)`
      );
    }

    if (appointment.product_count && appointment.product_count > 20) {
      warnings.push("Over 20 products — consider assigning 2 techs");
    }
  }

  if (
    appointment.appointment_type === "install" ||
    appointment.appointment_type === "jip"
  ) {
    const crewAppts = otherAppts.filter(
      (a) => a.crew_id === crew.id && a.time_block === "full_day"
    );
    if (crewAppts.length > 0) {
      errors.push(
        `${crew.name} is already booked for a full-day install on this date`
      );
    }
  }

  if (appointment.appointment_type === "install" && appointment.scheduled_date) {
    const schedDate = parseISO(appointment.scheduled_date);
    const weeksOut = differenceInWeeks(schedDate, new Date());
    if (weeksOut < 2) {
      warnings.push("Install scheduled less than 2 weeks out — verify materials are ready");
    }
  }

  const blockConflict = otherAppts.find(
    (a) =>
      a.crew_id === crew.id &&
      a.time_block === appointment.time_block
  );
  if (blockConflict) {
    errors.push(
      `${crew.name} already has an appointment in this time block`
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
