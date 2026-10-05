/**
 * A resource who works several departments, as the scheduler sees them in the
 * week grid.
 *
 * Josh does measures, services and JIPs. The rules this pins:
 *  - he gets a row in every section his types cover, not just one;
 *  - his timed service fills every measure row its clock window touches;
 *  - a Department Assignment blocks the off-role sections for that day, with a
 *    "where he went" label rather than the time-off treatment;
 *  - a blocked day NEVER hides work that is actually booked on it.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, AvailabilityRule, Crew } from "@/lib/types";

const crews: Crew[] = [
  {
    id: "josh",
    name: "Josh McIntyre",
    crew_type: "svc",
    additional_types: ["measure_tech", "jip"],
    color: "#be123c",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    primary_crew_id: null,
    sort_order: 41,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  } as Crew,
];

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appt-1",
    crew_id: "josh",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "service",
    scheduled_date: "2026-10-08", // Thursday — a measure day
    start_time: "09:00",
    end_time: "11:00",
    time_block: null,
    time_block_end: null,
    duration_days: 1,
    customer_name: "Dana Service",
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

// "Service Mon–Wed, Measure Thu–Fri" — the real-world pattern.
const roleRules: AvailabilityRule[] = [
  {
    id: "r-svc",
    crew_id: "josh",
    kind: "role_assignment",
    department: "service",
    start_time: null,
    end_time: null,
    weekdays: [1, 2, 3],
    repeat_interval: 1,
    effective_start: "2020-01-01",
    effective_end: null,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "r-mt",
    crew_id: "josh",
    kind: "role_assignment",
    department: "measure",
    start_time: null,
    end_time: null,
    weekdays: [4, 5],
    repeat_interval: 1,
    effective_start: "2020-01-01",
    effective_end: null,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
];

const state = {
  appointments: [appt({ id: "svc-thu" })] as Appointment[],
  availabilityRules: [] as AvailabilityRule[],
};

vi.mock("./DataProvider", () => ({
  useData: () => ({
    crews,
    appointments: state.appointments,
    rforceOrders: [],
    timeOffRequests: [],
    availabilityRules: state.availabilityRules,
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
      {/* Mon 2026-10-05 — the week holding Mon–Fri. */}
      <CrewBlockView currentDate={new Date("2026-10-05T12:00:00")} />
    </SchedulerDragProvider>
  );
}

function rowFor(label: string) {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(label))!;
}

describe("a resource who works several departments", () => {
  it("gets a row in every section their types cover", () => {
    state.appointments = [];
    state.availabilityRules = [];
    renderWeek();
    expect(screen.getByText("MEASURES")).toBeInTheDocument();
    expect(screen.getByText("SERVICE")).toBeInTheDocument();
    expect(screen.getByText("JIPS/WOP")).toBeInTheDocument();
    // His name appears once per section he belongs to.
    expect(screen.getAllByText("Josh M").length).toBe(3);
  });

  it("fills every measure row a timed service overlaps", () => {
    state.appointments = [appt({ id: "svc-thu" })]; // 9–11 on Thursday
    state.availabilityRules = [];
    renderWeek();
    // 9–11 covers the 9-10 and 10-12 rows, and nothing later.
    expect(within(rowFor("9–10a")).getByLabelText(/Dana Service/)).toBeInTheDocument();
    expect(within(rowFor("10–12")).getByLabelText(/Dana Service/)).toBeInTheDocument();
    expect(within(rowFor("12–2p")).queryByLabelText(/Dana Service/)).not.toBeInTheDocument();
  });

  it("marks out-of-department work as belonging to another desk", () => {
    state.appointments = [appt({ id: "svc-thu" })];
    state.availabilityRules = [];
    renderWeek();
    // The measure grid labels it a service and says it is not this desk's.
    expect(
      within(rowFor("9–10a")).getByLabelText(/Dana Service.*other department/i)
    ).toBeInTheDocument();
  });

  it("blocks the off-role days and says where the person went", () => {
    state.appointments = [];
    state.availabilityRules = roleRules;
    renderWeek();
    // Mon/Tue/Wed are service days, so his measure and JIP rows are reserved
    // for those three days (the blocked cell spans the section's rows).
    const reserved = screen.getAllByTitle(/Josh McIntyre is assigned to Service/);
    expect(reserved.length).toBe(6); // 3 days x 2 off-role sections
    expect(screen.getAllByText("Service").length).toBeGreaterThan(0);

    // Thu/Fri flip the other way: the service row is reserved for Measure.
    expect(screen.getAllByTitle(/Josh McIntyre is assigned to Measure/).length).toBe(4);
  });

  it("never uses the time-off treatment for a role block", () => {
    state.appointments = [];
    state.availabilityRules = roleRules;
    renderWeek();
    // "OFF" is reserved for actual time off — a reserved day must not read as one.
    expect(screen.queryByText("OFF")).not.toBeInTheDocument();
  });

  it("still shows work booked on a blocked day", () => {
    // A measure booked on Monday — a day his rules reserve for Service.
    state.appointments = [
      appt({
        id: "mt-mon",
        appointment_type: "tech_measure",
        scheduled_date: "2026-10-05",
        time_block: "10-12",
        start_time: "10:00",
        end_time: "12:00",
        customer_name: "Casey Measure",
      }),
    ];
    state.availabilityRules = roleRules;
    renderWeek();
    // The block must not swallow it — hiding a booking would let a scheduler
    // double-book a slot that is already taken.
    expect(within(rowFor("10–12")).getByLabelText(/Casey Measure/)).toBeInTheDocument();
  });
});
