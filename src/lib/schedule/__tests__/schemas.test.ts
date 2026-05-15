import { describe, expect, it } from "vitest";
import {
  createShiftInputSchema,
  createShiftTemplateInputSchema,
  deleteShiftInputSchema,
  deleteShiftTemplateInputSchema,
  updateShiftInputSchema,
  updateShiftTemplateInputSchema,
} from "@/lib/schedule/schemas";

const uuid = "00000000-0000-0000-0000-000000000001";

describe("createShiftInputSchema", () => {
  const valid = {
    classId: uuid,
    employeeId: uuid,
    date: "2026-05-18",
    startTime: "08:00",
    endTime: "12:00",
  };
  it("parses a valid input", () => {
    expect(() => createShiftInputSchema.parse(valid)).not.toThrow();
  });
  it("accepts an optional sourceTemplateId", () => {
    expect(() => createShiftInputSchema.parse({ ...valid, sourceTemplateId: uuid })).not.toThrow();
  });
  it("rejects bad date format", () => {
    expect(() => createShiftInputSchema.parse({ ...valid, date: "2026/05/18" })).toThrow();
  });
  it("rejects non-real date", () => {
    expect(() => createShiftInputSchema.parse({ ...valid, date: "2026-02-30" })).toThrow();
  });
  it("rejects non-15-min granular times", () => {
    expect(() => createShiftInputSchema.parse({ ...valid, startTime: "08:07" })).toThrow();
  });
  it("rejects start >= end", () => {
    expect(() => createShiftInputSchema.parse({ ...valid, startTime: "12:00", endTime: "08:00" })).toThrow();
    expect(() => createShiftInputSchema.parse({ ...valid, startTime: "08:00", endTime: "08:00" })).toThrow();
  });
});

describe("updateShiftInputSchema", () => {
  it("requires shiftId; other fields optional", () => {
    expect(() => updateShiftInputSchema.parse({ shiftId: uuid })).not.toThrow();
    expect(() => updateShiftInputSchema.parse({ shiftId: uuid, startTime: "09:00", endTime: "13:00" })).not.toThrow();
  });
  it("rejects partial time updates (must set both or neither)", () => {
    expect(() => updateShiftInputSchema.parse({ shiftId: uuid, startTime: "09:00" })).toThrow();
  });
});

describe("deleteShiftInputSchema", () => {
  it("requires shiftId (uuid)", () => {
    expect(() => deleteShiftInputSchema.parse({ shiftId: uuid })).not.toThrow();
    expect(() => deleteShiftInputSchema.parse({ shiftId: "not-a-uuid" })).toThrow();
  });
});

describe("createShiftTemplateInputSchema", () => {
  const valid = {
    classId: uuid,
    employeeId: uuid,
    dayOfWeek: 0,
    startTime: "08:00",
    endTime: "12:00",
    effectiveFromISO: "2026-05-18",
  };
  it("parses valid input", () => {
    expect(() => createShiftTemplateInputSchema.parse(valid)).not.toThrow();
  });
  it("rejects dayOfWeek outside [0,4]", () => {
    expect(() => createShiftTemplateInputSchema.parse({ ...valid, dayOfWeek: 5 })).toThrow();
    expect(() => createShiftTemplateInputSchema.parse({ ...valid, dayOfWeek: -1 })).toThrow();
  });
  it("rejects non-Monday effectiveFromISO", () => {
    expect(() => createShiftTemplateInputSchema.parse({ ...valid, effectiveFromISO: "2026-05-20" })).toThrow();
  });
});

describe("updateShiftTemplateInputSchema and delete", () => {
  it("update requires templateId, allows partial updates", () => {
    expect(() => updateShiftTemplateInputSchema.parse({ templateId: uuid })).not.toThrow();
    expect(() => updateShiftTemplateInputSchema.parse({ templateId: uuid, startTime: "09:00", endTime: "13:00" })).not.toThrow();
  });
  it("delete requires templateId uuid", () => {
    expect(() => deleteShiftTemplateInputSchema.parse({ templateId: uuid })).not.toThrow();
    expect(() => deleteShiftTemplateInputSchema.parse({ templateId: "bad" })).toThrow();
  });
});
