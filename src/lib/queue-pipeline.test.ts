import { describe, expect, it } from "vitest";
import { buildQueueItems } from "./queue-pipeline";
import type { Appointment, Crew, RForceOrder } from "./types";

const crew = { id: "crew-1", name: "Crew A", aliases: null } as Crew;
const scheduled = {
  id: "appt-1",
  crew_id: "crew-1",
  work_order_number: "WO-2",
  scheduled_date: "2026-08-15",
  start_time: "09:00",
  status: "scheduled",
  appointment_type: "service",
  customer_name: "Local",
  address: "1 Main St",
} as Appointment;
function rf(workOrder: string, start: string | null): RForceOrder {
  return {
    id: `rf-${workOrder}`,
    work_order_number: workOrder,
    scheduled_start: start,
    customer_name: workOrder,
    address: "1 Main St, Toledo, OH 43604",
    primary_resource: "Crew A",
    work_order_type: "Service",
  } as RForceOrder;
}

describe("focused scheduler queue", () => {
  it("shows only confirmation, mismatch, unscheduled, and returned local work", () => {
    const items = buildQueueItems(
      [rf("WO-1", "2026-08-14T09:00:00"), rf("WO-2", "2026-08-14T09:00:00"), rf("WO-3", null)],
      [scheduled],
      [],
      [crew],
      [],
      [],
      []
    );
    expect(items.map((item) => item.category)).toEqual([
      "needs_confirmation",
      "discrepancy",
      "unscheduled",
    ]);
    expect(items.some((item) => item.category === "merge_suggested" || item.category === "not_in_rforce"))
      .toBe(false);
  });

  it("hides a job already booked in the app that rForce hasn't caught up to", () => {
    // rForce's row is still the measure phase; the app has the install booked.
    // That's "pending rForce" on the Issues tab — not a queue item, and not a
    // false "discrepancy".
    const measureRow = { ...rf("WO-2", "2026-08-14T09:00:00"), work_order_type: "Tech Measure" };
    const install = { ...scheduled, appointment_type: "install" } as Appointment;
    const items = buildQueueItems([measureRow], [install], [], [crew], [], [], []);
    expect(items.map((item) => item.id)).not.toContain("WO-2");
  });
});

describe("suggested pairs for hand-entered tiles", () => {
  const manual = {
    ...scheduled,
    id: "appt-manual",
    work_order_number: null,
    customer_name: "WO-9",
    scheduled_date: "2026-08-14",
  } as Appointment;

  it("surfaces a WO-less tile as merge_suggested instead of needs_confirmation", () => {
    const items = buildQueueItems([rf("WO-9", "2026-08-14T09:00:00")], [manual], [], [crew], [], [], []);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("merge_suggested");
    expect(items[0].fuzzyMatch?.appointment.id).toBe("appt-manual");
    expect(items[0].hasPossibleMerge).toBe(true);
  });

  it("falls back to needs_confirmation once the pair was rejected", () => {
    const items = buildQueueItems(
      [rf("WO-9", "2026-08-14T09:00:00")], [manual], [], [crew], [], [], [],
      [{ id: "r1", appointment_id: "appt-manual", work_order_number: "WO-9", rejected_by: null, rejected_at: "", reason: null }]
    );
    expect(items[0].category).toBe("needs_confirmation");
  });
});
