import { describe, it, expect } from "vitest";
import { addressKey, addressesMatch } from "./address-match";

describe("addressKey", () => {
  it("normalizes suffixes and directions", () => {
    expect(addressKey("123 North Main Street, Springfield, OR 97477")).toEqual({
      street: "123 n main st",
      zip: "97477",
    });
  });

  it("returns an empty street for non-street input", () => {
    expect(addressKey("")).toEqual({ street: "", zip: "" });
    expect(addressKey(null).street).toBe("");
    expect(addressKey("Springfield, OR").street).toBe("");
  });

  it("ignores unit words", () => {
    expect(addressKey("45 Oak Ave Apt 2").street).toBe(addressKey("45 Oak Avenue 2").street);
  });
});

describe("addressesMatch", () => {
  it("matches the same house spelled differently", () => {
    expect(
      addressesMatch(addressKey("123 N Main St, Eugene OR 97401"), addressKey("123 North Main Street"))
    ).toBe(true);
  });

  it("rejects the same street line in a different ZIP", () => {
    expect(
      addressesMatch(addressKey("123 Main St, A 97401"), addressKey("123 Main St, B 97477"))
    ).toBe(false);
  });

  it("never matches an empty street", () => {
    expect(addressesMatch(addressKey(""), addressKey(""))).toBe(false);
  });
});
