import { describe, it, expect } from "vitest";
import { resolveJobLinks, EMPTY_JOB_LINKS, isValidHttpUrl, type JobLinkData } from "./job-links";
import { addressKey } from "./address-match";

const appt = (over: Record<string, unknown>) =>
  ({ appointment_type: "install", order_number: "A1", address: "123 N Main St, Eugene, OR 97401", ...over }) as never;

function data(over: Partial<JobLinkData> = {}): JobLinkData {
  return { ...EMPTY_JOB_LINKS, legacy: new Map(), linked: new Map(), writeUps: new Map(), ...over };
}

describe("resolveJobLinks — install tiles", () => {
  it("shows the material list when one exists", () => {
    const r = resolveJobLinks(appt({}), data({ linked: new Map([["A1", "job-9"]]) }), true);
    expect(r.installDocUrl).toContain("/install/job-9");
    expect(r.legacyUrl).toBeNull();
  });

  it("material list overrides a legacy link", () => {
    const r = resolveJobLinks(
      appt({}),
      data({ linked: new Map([["A1", "j"]]), legacy: new Map([["A1", "https://drive/x"]]) }),
      true
    );
    expect(r.installDocUrl).not.toBeNull();
    expect(r.legacyUrl).toBeNull();
  });

  it("falls back to the legacy link", () => {
    const r = resolveJobLinks(appt({}), data({ legacy: new Map([["A1", "https://drive/x"]]) }), true);
    expect(r.legacyUrl).toBe("https://drive/x");
    expect(r.installDocUrl).toBeNull();
  });

  it("shows nothing without an order number", () => {
    const r = resolveJobLinks(appt({ order_number: null }), data({ legacy: new Map([["A1", "u"]]) }), true);
    expect(r.legacyUrl).toBeNull();
  });
});

describe("resolveJobLinks — service tiles", () => {
  const key = addressKey("123 N Main St, Eugene, OR 97401");
  const writeUps = new Map([
    [key.street, [{ id: "w1", orderNumber: "X", zip: "97401" }, { id: "w2", orderNumber: "Y", zip: "" }]],
  ]);

  it("matches write-ups by address and counts orders", () => {
    const r = resolveJobLinks(appt({ appointment_type: "service" }), data({ writeUps }), true);
    expect(r.writeUpCount).toBe(2);
    expect(r.writeUpOrders).toBe(2);
    expect(r.writeUpUrl).toContain("/work-orders/address/");
  });

  it("ignores a write-up in a different ZIP", () => {
    const r = resolveJobLinks(
      appt({ appointment_type: "service", address: "123 N Main St, Eugene, OR 97477" }),
      data({ writeUps: new Map([[key.street, [{ id: "w1", orderNumber: "X", zip: "97401" }]]]) }),
      true
    );
    expect(r.writeUpCount).toBe(0);
  });

  it("shows nothing for roles that cannot see write-ups", () => {
    const r = resolveJobLinks(appt({ appointment_type: "service" }), data({ writeUps }), false);
    expect(r.writeUpCount).toBe(0);
  });

  it("service tiles never get install chips", () => {
    const r = resolveJobLinks(
      appt({ appointment_type: "service" }),
      data({ linked: new Map([["A1", "j"]]) }),
      true
    );
    expect(r.installDocUrl).toBeNull();
  });
});

describe("other types", () => {
  it("measures get nothing", () => {
    const r = resolveJobLinks(
      appt({ appointment_type: "tech_measure" }),
      data({ linked: new Map([["A1", "j"]]) }),
      true
    );
    expect(r.installDocUrl).toBeNull();
    expect(r.writeUpCount).toBe(0);
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isValidHttpUrl("https://drive.google.com/x")).toBe(true);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("nope")).toBe(false);
  });
});
