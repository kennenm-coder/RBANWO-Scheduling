/**
 * End-to-end reproduction of the "clicking an issue tile unpairs the board" bug.
 *
 * This drives the REAL pairing function (deriveRForceCalendarStatus) against the
 * appointment list each window strategy would leave in memory, so it demonstrates
 * the actual user-visible symptom rather than just the date arithmetic.
 */
import { describe, it, expect } from "vitest";
import { addDays, subDays, format, parseISO } from "date-fns";
import { deriveRForceCalendarStatus } from "./rforce-calendar-status";
import { planWindowExtension, type DateWindow } from "./date-window";
import type { Appointment, RForceOrder, Crew } from "./types";

const TODAY = parseISO("2026-10-07");
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

const crews: Crew[] = [
  { id: "crew-1", name: "Crew A", crew_type: "install_in_house", color: "#000", is_active: true, notes: null, aliases: null, manages: null, additional_types: null, primary_crew_id: null, sort_order: 0, created_at: "", updated_at: "" } as Crew,
];

function appt(id: string, date: string, wo: string): Appointment {
  return {
    id, crew_id: "crew-1", secondary_crew_id: null, tertiary_crew_id: null,
    appointment_type: "install", scheduled_date: date, start_time: "08:00",
    end_time: "16:00", time_block: "full_day", duration_days: 1,
    customer_name: "C", address: "A", order_number: null, work_order_number: wo,
    product_count: null, notes: null, status: "scheduled", origin: "manual",
    sync_state: null, version: 1, created_at: "", updated_at: "",
    manual_override: false, override_source: null, salesforce_url: null,
    scheduled_by: null, reschedule_reason: null, merge_source_wo: null,
    time_block_end: null, original_entry_snapshot: null,
    last_reconciled_import_id: null,
  } as unknown as Appointment;
}

function order(id: string, date: string, wo: string): RForceOrder {
  return {
    id, work_order_number: wo, customer_name: "C", address: "A",
    order_number: null, product_count: null,
    scheduled_start: `${date}T08:00:00`, primary_resource: "Crew A",
    tech_measure_name: null, installer: "Crew A", service_rep: null,
    work_order_type: "Install", import_batch_id: null, display_mode: "overlay",
    created_at: "", updated_at: "",
  } as unknown as RForceOrder;
}

/** What loadData() establishes on boot. */
const BOOT: DateWindow = { start: ymd(subDays(TODAY, 30)), end: ymd(addDays(TODAY, 180)) };

/** A job today, and one booked well out — both present in rForce and on the calendar. */
const TODAY_WO = "WO-TODAY";
const FAR_WO = "WO-FAR";
const FAR_DATE = ymd(addDays(TODAY, 240)); // beyond the boot window; rForce has no upper bound
const allAppointments = [
  appt("a-today", ymd(TODAY), TODAY_WO),
  appt("a-far", FAR_DATE, FAR_WO),
];
const allOrders = [order("rf-today", ymd(TODAY), TODAY_WO), order("rf-far", FAR_DATE, FAR_WO)];

const inWindow = (w: DateWindow) =>
  allAppointments.filter(
    (a) => !!a.scheduled_date && a.scheduled_date >= w.start && a.scheduled_date <= w.end
  );

const statusOf = (wo: string, held: Appointment[]) =>
  deriveRForceCalendarStatus(allOrders, held, [], crews).find(
    (i) => i.rforceOrder.work_order_number === wo
  )!.status;

describe("issue-tile click → board unpairs (regression)", () => {
  it("today's job is paired on a freshly loaded board", () => {
    expect(statusOf(TODAY_WO, inWindow(BOOT))).not.toBe("needs_confirmation");
  });

  it("OLD re-centring window: opening a far-dated issue unpairs today's job", () => {
    // Exactly what ensureDateRange used to do: slide the window onto the clicked
    // date and REPLACE the appointment list with that slice.
    const oldWindow: DateWindow = {
      start: ymd(subDays(parseISO(FAR_DATE), 60)),
      end: ymd(addDays(parseISO(FAR_DATE), 180)),
    };
    const held = inWindow(oldWindow);

    // Today's tile has dropped out of memory entirely...
    expect(held.some((a) => a.id === "a-today")).toBe(false);
    // ...so the rForce row for today now reads as "not on calendar".
    expect(statusOf(TODAY_WO, held)).toBe("needs_confirmation");
  });

  it("NEW growing window: the same click keeps today's job paired", () => {
    const plan = planWindowExtension(BOOT, parseISO(FAR_DATE));
    expect(plan).not.toBeNull();

    // Merge, as DataProvider now does, rather than replace.
    const byId = new Map(inWindow(BOOT).map((a) => [a.id, a]));
    for (const a of inWindow(plan!.window)) byId.set(a.id, a);
    const held = Array.from(byId.values());

    expect(held.some((a) => a.id === "a-today")).toBe(true);
    expect(statusOf(TODAY_WO, held)).not.toBe("needs_confirmation");
    // And the far job the user went to look at is paired too.
    expect(statusOf(FAR_WO, held)).not.toBe("needs_confirmation");
  });

  it("an empty result cannot unpair the board under the new merge", () => {
    // The silent failure mode confirmed against the live database: an
    // unauthenticated read returns 200 with [] and no error. Merging makes that
    // inert, where replacing would have blanked the board.
    const held = inWindow(BOOT);
    const byId = new Map(held.map((a) => [a.id, a]));
    for (const a of [] as Appointment[]) byId.set(a.id, a);
    expect(statusOf(TODAY_WO, Array.from(byId.values()))).not.toBe("needs_confirmation");
  });
});
