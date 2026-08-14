import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchedulerDragProvider, useSchedulerDrag } from "./drag-context";
import type { Appointment } from "./types";

const appointment = { id: "appt-1" } as Appointment;

function Harness() {
  const { draggedAppointment, setDraggedAppointment, clearDrag } = useSchedulerDrag();
  return (
    <>
      <output>{draggedAppointment?.appointment.id || "empty"}</output>
      <button onClick={() => setDraggedAppointment({ appointment, sourceCrewId: "crew-1", sourceDate: "2026-08-14", sourceTimeBlock: null })}>start</button>
      <button onClick={clearDrag}>clear</button>
    </>
  );
}

describe("SchedulerDragProvider", () => {
  it("owns and clears drag state within the React tree", () => {
    render(<SchedulerDragProvider><Harness /></SchedulerDragProvider>);
    expect(screen.getByText("empty")).toBeInTheDocument();
    fireEvent.click(screen.getByText("start"));
    expect(screen.getByText("appt-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
