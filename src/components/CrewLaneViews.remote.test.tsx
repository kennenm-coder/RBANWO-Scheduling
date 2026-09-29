/**
 * The Remote row in the two lane views.
 *
 * Week view: an extra "REM" row above each measure tech's 9-10 … 4-6 grid.
 * Day view: a Remote strip above the tech's timeline, because a remote measure
 * has no position on the clock and must never be drawn as a 30-minute tile.
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
    customer_name: "Pat Onsite",
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
  appt({ id: "appt-onsite" }),
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
    calendarBlocks: [],
    activeLinks: [],
    resourceMappings: [],
    dismissals: [],
    exportDates: [],
    updateAppointment: vi.fn(),
    approveRForce: vi.fn(),
    dismissRForce: vi.fn(),
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

// Leaflet doesn't render under jsdom, and the map isn't what's under test.
vi.mock("./SectionMap", () => ({ default: () => null }));

import CrewLaneWeekView from "./CrewLaneWeekView";
import CrewLaneDayView from "./CrewLaneDayView";
import { SchedulerDragProvider } from "@/lib/drag-context";

const DAY = new Date("2026-10-06T12:00:00");

describe("week view", () => {
  function renderWeek() {
    return render(
      <SchedulerDragProvider>
        <CrewLaneWeekView currentDate={DAY} onDayClick={() => {}} />
      </SchedulerDragProvider>
    );
  }

  it("puts a REM row above the on-site blocks in every day cell", () => {
    const { container } = renderWeek();
    const labels = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.textContent === "REM" && el.children.length === 0
    );
    expect(labels.length).toBeGreaterThan(0);
    const rem = labels[0].closest("div[title]")!;
    const cell = rem.parentElement!;
    const rowLabels = Array.from(cell.children).map((r) => r.textContent?.slice(0, 3));
    expect(rowLabels[0]).toBe("REM");
  });

  it("draws the remote measure in the REM row, not in a time block", () => {
    const { container } = renderWeek();
    // One REM row per day column; the tile belongs to exactly one of them.
    const remRows = Array.from(
      container.querySelectorAll('div[title="Remote measures — no on-site time"]')
    ) as HTMLElement[];
    expect(remRows.filter((r) => within(r).queryByText(/Remotely/))).toHaveLength(1);
    expect(remRows.some((r) => within(r).queryByText(/Onsite/))).toBe(false);
  });
});

describe("day view", () => {
  function renderDay() {
    return render(
      <SchedulerDragProvider>
        <CrewLaneDayView date={DAY} />
      </SchedulerDragProvider>
    );
  }

  it("gives the measure tech a Remote strip holding the remote measure", () => {
    const { container } = renderDay();
    const strip = Array.from(container.querySelectorAll("div[title]")).find(
      (el) => el.getAttribute("title") === "Remote measures — no on-site time"
    )! as HTMLElement;
    expect(within(strip).getByText("Robin Remotely")).toBeInTheDocument();
    expect(within(strip).getByText("+ Remote")).toBeInTheDocument();
  });

  it("keeps the remote measure off the timeline — it has no place on the clock", () => {
    renderDay();
    // The timeline tile carries the accessible name; the strip chip does not.
    expect(screen.getByLabelText(/Open Pat Onsite appointment/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Open Robin Remotely appointment/)).not.toBeInTheDocument();
  });
});
