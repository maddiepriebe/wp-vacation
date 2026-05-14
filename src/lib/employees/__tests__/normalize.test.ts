import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/employees/normalize";

describe("normalizeEmail", () => {
  it("lowercases the entire string", () => {
    expect(normalizeEmail("Jane@Example.COM")).toBe("jane@example.com");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  jane@example.com  ")).toBe("jane@example.com");
  });
  it("does both at once", () => {
    expect(normalizeEmail("  Jane@EXAMPLE.com\n")).toBe("jane@example.com");
  });
  it("returns empty string for empty input", () => {
    expect(normalizeEmail("")).toBe("");
  });
});
