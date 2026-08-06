import { describe, it, expect } from "vitest";
import { normalizeWoType, getWoTypeColor, getAvailableWoTypes, WO_TYPE_COLORS } from "./wo-type-colors";

describe("normalizeWoType", () => {
  it("normalizes standard rForce type strings", () => {
    expect(normalizeWoType("Tech Measure")).toBe("tech_measure");
    expect(normalizeWoType("Install")).toBe("install");
    expect(normalizeWoType("Service")).toBe("service");
    expect(normalizeWoType("JIP")).toBe("jip");
    expect(normalizeWoType("LSWP")).toBe("lswp");
    expect(normalizeWoType("HOA")).toBe("hoa");
    expect(normalizeWoType("Paint/Stain")).toBe("paint_stain");
  });

  it("normalizes JIP aliases", () => {
    expect(normalizeWoType("Job Site Visit")).toBe("jip");
    expect(normalizeWoType("Job Site Visit/JIP")).toBe("jip");
  });

  it("normalizes Paint and Stain variants", () => {
    expect(normalizeWoType("Paint")).toBe("paint_stain");
    expect(normalizeWoType("Stain")).toBe("paint_stain");
  });

  it("returns 'unknown' for null, undefined, or unrecognized", () => {
    expect(normalizeWoType(null)).toBe("unknown");
    expect(normalizeWoType(undefined)).toBe("unknown");
    expect(normalizeWoType("")).toBe("unknown");
    expect(normalizeWoType("SomethingNew")).toBe("unknown");
  });
});

describe("getWoTypeColor", () => {
  it("returns correct color config for known types", () => {
    const installColor = getWoTypeColor("install");
    expect(installColor.hex).toBe("#3b82f6");
    expect(installColor.label).toBe("Install");
  });

  it("returns unknown color for unrecognized types", () => {
    const unkColor = getWoTypeColor("nonexistent");
    expect(unkColor.hex).toBe(WO_TYPE_COLORS.unknown.hex);
  });
});

describe("getAvailableWoTypes", () => {
  it("returns unique types sorted by count descending", () => {
    const items = [
      { normalizedWoType: "install" },
      { normalizedWoType: "install" },
      { normalizedWoType: "install" },
      { normalizedWoType: "service" },
      { normalizedWoType: "tech_measure" },
      { normalizedWoType: "tech_measure" },
    ];
    const result = getAvailableWoTypes(items);
    expect(result).toHaveLength(3);
    expect(result[0].value).toBe("install");
    expect(result[0].count).toBe(3);
    expect(result[1].value).toBe("tech_measure");
    expect(result[1].count).toBe(2);
    expect(result[2].value).toBe("service");
    expect(result[2].count).toBe(1);
  });

  it("returns empty array for no items", () => {
    expect(getAvailableWoTypes([])).toHaveLength(0);
  });
});
