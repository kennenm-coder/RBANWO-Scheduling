/**
 * Choosing which rows a resource appears on, as the scheduler sees it.
 *
 * Todd runs JIPs and also covers installs. Narrowed to the JIP row he reads as
 * one row — but that row still carries his install work, flagged as another
 * department's, and his Department Assignment rules show as a day tag rather
 * than blocking the row (blocking the only row would hide his whole day).
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, AvailabilityRule, Crew } from "@/lib/types";

const state = {
  crews: [] as Crew[],
  appointments: [] as Appointment[],
  availabilityRules: [] as AvailabilityRule[],
};

function todd(rows: string[] | null): Crew {
  return {
    id: "todd",
    name: "Todd Williams",
    crew_type: "jip",
    additional_types: ["install_in_house"],
    visible_sections: rows,
    color: "#6d28d9",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    primary_crew_id: null,
    sort_order: 31,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  } as Crew;
}

function installJob(): Appointment {
  return {
    id: "install-1",
    crew_id: "todd",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    scheduled_date: "2026-10-07", // Wednesday
    start_time: "08:00",
    end_time: "16:00",
    time_block: "full_day",
    time_block_end: null,
    is_full_day: true,
    duration_days: 1,
    customer_name: "Blake Install",
    address: "9 Oak St",
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
  } as Appointment;
}

const installMonWed: AvailabilityRule = {
  id: "r-install",
  crew_id: "todd",
  kind: "role_assignment",
  department: "install",
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
};

vi.mock("./DataProvider", () => ({
  useData: () => ({
    crews: state.crews,
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

describe("choosing which rows a resource appears on", () => {
  it("drops the rows that were turned off", () => {
    state.crews = [todd(["jip"])];
    state.appointments = [];
    state.availabilityRules = [];
    renderWeek();
    expect(screen.getByText("JIPS/WOP")).toBeInTheDocument();
    expect(screen.queryByText("INSTALLS")).not.toBeInTheDocument();
    expect(screen.getAllByText("Todd W").length).toBe(1);
  });

  it("shows every qualified row when nothing is chosen", () => {
    state.crews = [todd(null)];
    state.appointments = [];
    state.availabilityRules = [];
    renderWeek();
    expect(screen.getByText("JIPS/WOP")).toBeInTheDocument();
    expect(screen.getByText("INSTALLS")).toBeInTheDocument();
  });

  it("keeps the other department's work on the surviving row", () => {
    state.crews = [todd(["jip"])];
    state.appointments = [installJob()];
    state.availabilityRules = [];
    renderWeek();
    // His install job is still on screen even though the Installs section is gone.
    expect(screen.getByLabelText(/Blake Install/)).toBeInTheDocument();
  });

  it("flags that work as another department's", () => {
    state.crews = [todd(["jip"])];
    state.appointments = [installJob()];
    state.availabilityRules = [];
    renderWeek();
    expect(screen.getByLabelText(/Blake Install.*other department/i)).toBeInTheDocument();
  });

  it("never blocks the one row — that would hide the whole day", () => {
    state.crews = [todd(["jip"])];
    state.appointments = [];
    state.availabilityRules = [installMonWed];
    renderWeek();
    // No "assigned to" hatch anywhere: there is no second row to send him to.
    expect(screen.queryAllByTitle(/is assigned to/).length).toBe(0);
  });

  it("shows the day's department as a tag instead", () => {
    state.crews = [todd(["jip"])];
    state.appointments = [];
    state.availabilityRules = [installMonWed];
    renderWeek();
    // Mon/Tue/Wed carry the Install tag; Thu/Fri have no rule and no tag.
    expect(screen.getAllByText("INS").length).toBe(3);
  });
});
