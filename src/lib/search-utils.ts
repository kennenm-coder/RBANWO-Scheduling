import { Appointment, RForceOrder, Crew } from "./types";
import { RForceCalendarItem } from "./calendar-utils";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const norm = normalize(query);
  if (!norm) return true;
  return fields.some((f) => f && normalize(f).includes(norm));
}

export function searchAppointments(
  appointments: Appointment[],
  crews: Crew[],
  query: string
): Appointment[] {
  if (!query.trim()) return appointments;
  const crewMap = new Map(crews.map((c) => [c.id, c]));
  return appointments.filter((a) => {
    const crew = a.crew_id ? crewMap.get(a.crew_id) : undefined;
    return matchesQuery(
      [
        a.customer_name,
        a.address,
        a.order_number,
        a.work_order_number,
        a.notes,
        crew?.name,
        a.appointment_type,
        a.time_block,
      ],
      query
    );
  });
}

export function searchRForceOrders(
  orders: RForceOrder[],
  query: string
): RForceOrder[] {
  if (!query.trim()) return orders;
  return orders.filter((r) =>
    matchesQuery(
      [
        r.customer_name,
        r.address,
        r.order_number,
        r.work_order_number,
        r.work_order_type,
        r.primary_resource,
        r.tech_measure_name,
        r.installer,
        r.service_rep,
      ],
      query
    )
  );
}

export function appointmentMatchesSearch(
  appt: Appointment,
  crew: Crew | undefined,
  query: string
): boolean {
  if (!query.trim()) return true;
  return matchesQuery(
    [
      appt.customer_name,
      appt.address,
      appt.order_number,
      appt.work_order_number,
      appt.notes,
      crew?.name,
      appt.appointment_type,
    ],
    query
  );
}

export function rforceItemMatchesSearch(
  item: RForceCalendarItem,
  crew: Crew | undefined,
  query: string
): boolean {
  if (!query.trim()) return true;
  const r = item.rforceOrder;
  return matchesQuery(
    [
      r.customer_name,
      r.address,
      r.order_number,
      r.work_order_number,
      r.work_order_type,
      crew?.name,
    ],
    query
  );
}
