import { describe, expect, it } from "vitest";
import {
  employeeImportRowSchema,
  employeeInputSchema,
} from "@/lib/employees/schemas";

describe("employeeInputSchema", () => {
  const valid = {
    first_name: "Maria",
    last_name: "L.",
    email: "Maria@Example.COM",
    role_in_class: "teacher" as const,
    default_class_id: "00000000-0000-0000-0000-000000000001",
    anniversary_date: "2025-01-15",
    scheduled_hours_per_week: 40,
  };

  it("parses a valid row and lowercases email", () => {
    const r = employeeInputSchema.parse(valid);
    expect(r.email).toBe("maria@example.com");
  });

  it("accepts optional phone", () => {
    expect(
      employeeInputSchema.parse({ ...valid, phone: "555-0100" }),
    ).toMatchObject({ phone: "555-0100" });
  });

  it("rejects missing required fields", () => {
    const { first_name: _ignored, ...rest } = valid;
    expect(() => employeeInputSchema.parse(rest)).toThrow();
  });

  it("rejects invalid role_in_class", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, role_in_class: "support" }),
    ).toThrow();
  });

  it("rejects invalid anniversary_date format", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, anniversary_date: "2025/01/15" }),
    ).toThrow();
  });

  it("rejects non-real anniversary_date", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, anniversary_date: "2025-02-30" }),
    ).toThrow();
  });

  it("rejects non-positive scheduled_hours_per_week", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: 0 }),
    ).toThrow();
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: -1 }),
    ).toThrow();
  });

  it("rejects scheduled_hours_per_week > 40 (sanity bound)", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: 50 }),
    ).toThrow();
  });
});

describe("employeeImportRowSchema", () => {
  const valid = {
    first_name: "Maria",
    last_name: "L.",
    email: "maria@example.com",
    role_in_class: "teacher" as const,
    default_class_name: "Pre-K",
    anniversary_date: "2025-01-15",
    scheduled_hours_per_week: 40,
  };

  it("parses a valid import row", () => {
    const r = employeeImportRowSchema.parse(valid);
    expect(r.default_class_name).toBe("Pre-K");
  });

  it("trims and preserves the case of class names (matching is case-insensitive but value is preserved)", () => {
    const r = employeeImportRowSchema.parse({
      ...valid,
      default_class_name: "  Pre-K  ",
    });
    expect(r.default_class_name).toBe("Pre-K");
  });

  it("rejects unknown role_in_class", () => {
    expect(() =>
      employeeImportRowSchema.parse({ ...valid, role_in_class: "manager" }),
    ).toThrow();
  });

  it("has no balance columns (vacation/personal/unpaid)", () => {
    // Should silently ignore extra balance columns rather than failing,
    // because Zod strips unknown keys by default. Confirm the parsed
    // object doesn't carry them.
    const r = employeeImportRowSchema.parse({
      ...valid,
      current_vacation_hours_remaining: 50,
      current_personal_hours_remaining: 10,
    } as never);
    expect(r).not.toHaveProperty("current_vacation_hours_remaining");
    expect(r).not.toHaveProperty("current_personal_hours_remaining");
  });
});
