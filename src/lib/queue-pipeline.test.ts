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
});
