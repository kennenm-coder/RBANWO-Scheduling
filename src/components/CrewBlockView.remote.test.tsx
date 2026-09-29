/**
 * The Remote row as the scheduler actually sees it in the week grid: an extra
 * row above 9-10 on every measure tech, holding the measures they did remotely.
 *
 * The rest of the remote-row rules are unit-tested in src/lib/remote-measure.test.ts;
 * this pins the part only the DOM can show — that the row exists, sits first, and
 * that remote work lands in it instead of the on-site grid.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, Crew } from "@/lib/types";

const crews: Crew[] = [
  {
    id: "crew-1",
    name: "Alex Tech",
    crew_type: "measure_tech",
    color: "#1a73e8",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    additional_types: null,
    primary_crew_id: null,
    sort_order: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  } as Crew,
];

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appt-1",
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "tech_measure",
    scheduled_date: "2026-10-06",
    start_time: "10:00",
    end_time: "12:00",
    time_block: "10-12",
    time_block_end: null,
    duration_days: 1,
    customer_name: "Onsite Family",
    address: "1 Main St",
    order_number: null,
    work_order_number: null,
    product_count: null,
    notes: null,
    status: "scheduled",
    origin: "manual",
    sync_state: "manual_awaiting_rforce",
    version: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    manual_override: false,
    override_source: null,
    salesforce_url: null,
    scheduled_by: null,
    reschedule_reason: null,
    merge_source_wo: null,
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    ...overrides,
  } as Appointment;
}

const appointments: Appointment[] = [
  appt({ id: "appt-onsite", customer_name: "Pat Onsite" }),
  appt({
    id: "appt-remote",
    customer_name: "Robin Remotely",
    time_block: "remote",
    start_time: "08:00",
    end_time: "08:30",
    resource_hours: 0,
  }),
];

vi.mock("./DataProvider", () => ({
  useData: () => ({
    crews,
    appointments,
    rforceOrders: [],
    timeOffRequests: [],
    availabilityRules: [],
    availabilityExceptions: [],
    updateAppointment: vi.fn(),
  }),
}));

vi.mock("./AuthProvider", () => ({
  useCurrentActor: () => ({ actorId: null, actorName: null }),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/lib/presence", () => ({
  usePresence: () => ({ setHoveredCell: vi.fn(), hoverColorFor: () => undefined }),
}));

import CrewBlockView from "./CrewBlockView";
import { SchedulerDragProvider } from "@/lib/drag-context";

function renderWeek() {
  return render(
    <SchedulerDragProvider>
      {/* Tue 2026-10-06 — the week containing both appointments. */}
      <CrewBlockView currentDate={new Date("2026-10-06T12:00:00")} />
    </SchedulerDragProvider>
  );
}

describe("the Remote row in the week grid", () => {
  it("is the measure tech's first row, above 9–10a", () => {
    renderWeek();
    const rows = screen.getAllByRole("row");
    const remoteRowIndex = rows.findIndex((r) => within(r).queryByText("Remote"));
    const firstBlockRowIndex = rows.findIndex((r) => within(r).queryByText("9–10a"));
    expect(remoteRowIndex).toBeGreaterThan(-1);
    expect(remoteRowIndex).toBeLessThan(firstBlockRowIndex);
    // The crew's name sits on its first row — which is now the Remote row.
    expect(within(rows[remoteRowIndex]).getByText("Alex T")).toBeInTheDocument();
  });

  it("holds the remote measure, and only that one", () => {
    renderWeek();
    const remoteRow = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByText("Remote"))!;
    // Tiles show the last name; the accessible name carries the full one.
    expect(within(remoteRow).getByLabelText(/Robin Remotely/)).toBeInTheDocument();
    expect(within(remoteRow).queryByLabelText(/Pat Onsite/)).not.toBeInTheDocument();
  });

  it("leaves the on-site measure in its own block row", () => {
    renderWeek();
    const onsiteRow = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByText("10–12"))!;
    expect(within(onsiteRow).getByLabelText(/Pat Onsite/)).toBeInTheDocument();
    expect(within(onsiteRow).queryByLabelText(/Robin Remotely/)).not.toBeInTheDocument();
  });
});
