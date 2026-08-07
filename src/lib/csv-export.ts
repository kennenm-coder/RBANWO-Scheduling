/**
 * CSV export utilities for comparing app data against rForce imports.
 */

import { Appointment, Crew, RForceOrder, AppointmentLink } from "./types";
import { typeLabel } from "./calendar-utils";

// ── Helpers ──

function esc(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: unknown[]): string {
  return cells.map(esc).join(",");
}

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── App Appointments Export ──

export function exportAppointments(
  appointments: Appointment[],
  crews: Crew[],
  activeLinks: AppointmentLink[]
) {
  const crewMap = new Map(crews.map((c) => [c.id, c]));
  const linksByAppt = new Map<string, AppointmentLink>();
  for (const link of activeLinks) {
    if (!link.unlinked_at) linksByAppt.set(link.appointment_id, link);
  }

  const header = [
    "Work Order #",
    "Order #",
    "Customer Name",
    "Address",
    "Scheduled Date",
    "Start Time",
    "Time Block",
    "Type",
    "Crew",
    "Status",
    "Product Count",
    "Linked to rForce",
    "Created At",
    "Notes",
  ];

  const rows = appointments
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""))
    .map((a) => {
      const crew = a.crew_id ? crewMap.get(a.crew_id) : undefined;
      const link = linksByAppt.get(a.id);
      return row([
        a.work_order_number,
        a.order_number,
        a.customer_name,
        a.address,
        a.scheduled_date,
        a.start_time,
        a.time_block,
        typeLabel(a.appointment_type),
        crew?.name || "",
        a.status,
        a.product_count,
        link ? "Yes" : "No",
        a.created_at?.slice(0, 10),
        a.notes,
      ]);
    });

  const csv = [row(header), ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`app-appointments_${date}.csv`, csv);
}

// ── Side-by-Side Comparison Export ──

export function exportComparison(
  appointments: Appointment[],
  rforceOrders: RForceOrder[],
  crews: Crew[],
  activeLinks: AppointmentLink[]
) {
  const crewMap = new Map(crews.map((c) => [c.id, c]));

  // Index rForce orders by WO number
  const rfByWo = new Map<string, RForceOrder>();
  for (const rf of rforceOrders) {
    rfByWo.set(rf.work_order_number, rf);
  }

  // Index links by appointment
  const linksByAppt = new Map<string, AppointmentLink>();
  for (const link of activeLinks) {
    if (!link.unlinked_at) linksByAppt.set(link.appointment_id, link);
  }

  const header = [
    "Work Order #",
    "Order #",
    "Customer Name",
    // App columns
    "App: Date",
    "App: Crew",
    "App: Time Block",
    "App: Type",
    "App: Status",
    "App: Product Count",
    // rForce columns
    "rForce: Date",
    "rForce: Resource",
    "rForce: Start Time",
    "rForce: Type",
    "rForce: WO Status",
    "rForce: Order Status",
    "rForce: Product Count",
    // Comparison
    "Linked",
    "Date Match",
    "Crew Match",
    "In App Only",
    "In rForce Only",
  ];

  type ComparisonRow = {
    wo: string;
    order: string;
    customer: string;
    appt?: Appointment;
    rf?: RForceOrder;
    crew?: Crew;
    linked: boolean;
  };

  const seen = new Set<string>();
  const items: ComparisonRow[] = [];

  // Start from app appointments
  const active = appointments.filter((a) => a.status !== "cancelled" && a.status !== "unscheduled");
  for (const a of active) {
    const wo = a.work_order_number || "";
    if (wo) seen.add(wo);
    const crew = a.crew_id ? crewMap.get(a.crew_id) : undefined;
    const rf = wo ? rfByWo.get(wo) : undefined;
    const linked = !!linksByAppt.get(a.id);
    items.push({
      wo,
      order: a.order_number || "",
      customer: a.customer_name,
      appt: a,
      rf,
      crew,
      linked,
    });
  }

  // Add rForce-only items
  for (const rf of rforceOrders) {
    if (seen.has(rf.work_order_number)) continue;
    items.push({
      wo: rf.work_order_number,
      order: rf.order_number || "",
      customer: rf.customer_name || "",
      rf,
      linked: false,
    });
  }

  // Sort by date (app date or rForce date)
  items.sort((a, b) => {
    const dateA = a.appt?.scheduled_date || a.rf?.scheduled_start?.slice(0, 10) || "";
    const dateB = b.appt?.scheduled_date || b.rf?.scheduled_start?.slice(0, 10) || "";
    return dateA.localeCompare(dateB);
  });

  const rows = items.map((item) => {
    const a = item.appt;
    const rf = item.rf;
    const rfResource = rf?.primary_resource || rf?.tech_measure_name || rf?.installer || rf?.service_rep || "";
    const rfDate = rf?.scheduled_start?.slice(0, 10) || "";
    const rfTime = rf?.scheduled_start?.slice(11, 16) || "";
    const appDate = a?.scheduled_date || "";
    const crewName = item.crew?.name || "";

    const dateMatch = appDate && rfDate ? (appDate === rfDate ? "Yes" : "NO") : "";
    const crewFirstApp = crewName.split(" ")[0]?.toLowerCase() || "";
    const crewFirstRf = rfResource.split(" ")[0]?.toLowerCase() || "";
    const crewMatch = crewFirstApp && crewFirstRf
      ? (crewFirstApp === crewFirstRf ? "Yes" : "NO")
      : "";

    return row([
      item.wo,
      item.order,
      item.customer,
      appDate,
      crewName,
      a?.time_block || "",
      a ? typeLabel(a.appointment_type) : "",
      a?.status || "",
      a?.product_count ?? "",
      rfDate,
      rfResource,
      rfTime,
      rf?.work_order_type || "",
      rf?.wo_status || "",
      rf?.order_status || "",
      rf?.product_count ?? "",
      item.linked ? "Yes" : "No",
      dateMatch,
      crewMatch,
      a && !rf ? "YES" : "",
      rf && !a ? "YES" : "",
    ]);
  });

  const csv = [row(header), ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`app-vs-rforce_${date}.csv`, csv);
}
