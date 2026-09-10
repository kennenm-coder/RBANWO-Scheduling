import { describe, it, expect } from "vitest";
import { toAppointmentWriteError } from "./store";

describe("toAppointmentWriteError — tells the two unique indexes apart", () => {
  it("maps the per-slot double-booking index to DOUBLE_BOOK", () => {
    const err = toAppointmentWriteError(
      { code: "23505", message: 'duplicate key value violates unique constraint "idx_no_double_book"' },
      "fallback"
    );
    expect(err.message).toBe("DOUBLE_BOOK");
  });

  it("maps the one-active-row-per-work-order index to DUPLICATE_WO (was misread as a crew double-book)", () => {
    const err = toAppointmentWriteError(
      { code: "23505", message: 'duplicate key value violates unique constraint "idx_unique_active_work_order"' },
      "fallback"
    );
    expect(err.message).toMatch(/^DUPLICATE_WO/);
  });

  it("maps the optimistic-concurrency miss to VERSION_CONFLICT", () => {
    expect(toAppointmentWriteError({ code: "PGRST116" }, "fallback").message).toBe("VERSION_CONFLICT");
  });

  it("preserves any other DB message verbatim (e.g. the conflict trigger's)", () => {
    const msg = "INVALID_TIME_RANGE: a scheduled appointment requires an end time after its start time";
    expect(toAppointmentWriteError({ code: "P0001", message: msg }, "fallback").message).toBe(msg);
  });

  it("falls back when the DB gives no message", () => {
    expect(toAppointmentWriteError({}, "Failed to save").message).toBe("Failed to save");
  });
});
