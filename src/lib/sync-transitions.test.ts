import { describe, it, expect } from "vitest";
import { captureOriginalEntry } from "./sync-transitions";
import type { Appointment } from "./types";

describe("captureOriginalEntry", () => {
  it("captures all fields from the appointment data", () => {
    const snapshot = captureOriginalEntry({
      customer_name: "Jane Doe",
      address: "456 Oak Ave, Toledo, OH 43615",
      scheduled_date: "2026-08-10",
      crew_id: "crew-abc",
      time_block: "9-10",
      start_time: "09:00:00",
      notes: "Side door entry",
      appointment_type: "install",
    });

    expect(snapshot.customer_name).toBe("Jane Doe");
    expect(snapshot.address).toBe("456 Oak Ave, Toledo, OH 43615");
    expect(snapshot.scheduled_date).toBe("2026-08-10");
    expect(snapshot.crew_id).toBe("crew-abc");
    expect(snapshot.time_block).toBe("9-10");
    expect(snapshot.start_time).toBe("09:00:00");
    expect(snapshot.notes).toBe("Side door entry");
    expect(snapshot.appointment_type).toBe("install");
    expect(snapshot.captured_at).toBeTruthy();
  });

  it("captures null fields correctly", () => {
    const snapshot = captureOriginalEntry({
      customer_name: "Test",
      address: "123 Main",
      scheduled_date: null,
      crew_id: null,
      time_block: null,
      start_time: null,
      notes: null,
      appointment_type: "service",
    });

    expect(snapshot.scheduled_date).toBeNull();
    expect(snapshot.crew_id).toBeNull();
    expect(snapshot.time_block).toBeNull();
    expect(snapshot.start_time).toBeNull();
    expect(snapshot.notes).toBeNull();
  });

  it("includes an ISO timestamp in captured_at", () => {
    const before = new Date().toISOString();
    const snapshot = captureOriginalEntry({
      customer_name: "Test",
      address: "123",
      scheduled_date: "2026-08-10",
      crew_id: null,
      time_block: "10-12",
      start_time: "10:00:00",
      notes: null,
      appointment_type: "tech_measure",
    });
    const after = new Date().toISOString();

    expect(snapshot.captured_at >= before).toBe(true);
    expect(snapshot.captured_at <= after).toBe(true);
  });
});
