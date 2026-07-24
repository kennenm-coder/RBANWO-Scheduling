import { Appointment, AppointmentType, Crew } from "./types";

interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateAppointment(
  appointment: Partial<Appointment>,
  existingForDay: Appointment[],
  crew: Crew,
  allCrews: Crew[]
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (appointment.appointment_type === "tech_measure") {
    const crewAppts = existingForDay.filter(
      (a) => a.crew_id === crew.id && a.status !== "cancelled"
    );
    if (crewAppts.length >= 4) {
      warnings.push(
        `${crew.name} already has ${crewAppts.length} appointments this day (max recommended: 3-4)`
      );
    }

    if (appointment.product_count && appointment.product_count > 20) {
      warnings.push(
        "Over 20 products — consider assigning 2 techs"
      );
    }
  }

  if (
    appointment.appointment_type === "install" ||
    appointment.appointment_type === "jip"
  ) {
    const crewAppts = existingForDay.filter(
      (a) =>
        a.crew_id === crew.id &&
        a.status !== "cancelled" &&
        a.time_block === "full_day"
    );
    if (crewAppts.length > 0) {
      errors.push(
        `${crew.name} is already booked for a full-day install on this date`
      );
    }
  }

  const blockConflict = existingForDay.find(
    (a) =>
      a.crew_id === crew.id &&
      a.time_block === appointment.time_block &&
      a.status !== "cancelled"
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
