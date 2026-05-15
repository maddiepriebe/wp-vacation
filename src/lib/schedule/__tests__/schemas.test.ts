import { describe, expect, it } from "vitest";
import {
  commitEnrollmentImportInputSchema,
  copyWeekInputSchema,
  createShiftInputSchema,
  createShiftTemplateInputSchema,
  deleteEnrollmentForecastInputSchema,
  deleteShiftInputSchema,
  deleteShiftTemplateInputSchema,
  enrollmentImportRowSchema,
  moveShiftInputSchema,
  saveAsTemplateInputSchema,
  updateShiftInputSchema,
  updateShiftTemplateInputSchema,
  upsertEnrollmentForecastInputSchema,
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

describe("moveShiftInputSchema", () => {
  const valid = {
    shiftId: "00000000-0000-0000-0000-000000000001",
    date: "2026-05-19",
    startTime: "08:00",
    endTime: "12:00",
  };
  it("parses a valid input", () => {
    expect(() => moveShiftInputSchema.parse(valid)).not.toThrow();
  });
  it("rejects start >= end", () => {
    expect(() => moveShiftInputSchema.parse({ ...valid, startTime: "12:00", endTime: "08:00" })).toThrow();
  });
  it("rejects bad date", () => {
    expect(() => moveShiftInputSchema.parse({ ...valid, date: "2026-02-30" })).toThrow();
  });
});

describe("saveAsTemplateInputSchema", () => {
  const valid = {
    classId: uuid,
    sourceWeekStartISO: "2026-05-18",
    effectiveFromISO: "2026-05-25",
    selectedShifts: [
      { source: "template", templateId: uuid },
      { source: "override", shiftId: uuid },
    ],
  };
  it("parses a valid input", () => {
    expect(() => saveAsTemplateInputSchema.parse(valid)).not.toThrow();
  });
  it("accepts an empty selectedShifts array (close-only)", () => {
    expect(() => saveAsTemplateInputSchema.parse({ ...valid, selectedShifts: [] })).not.toThrow();
  });
  it("rejects non-Monday sourceWeekStartISO", () => {
    expect(() => saveAsTemplateInputSchema.parse({ ...valid, sourceWeekStartISO: "2026-05-20" })).toThrow();
  });
  it("rejects non-Monday effectiveFromISO", () => {
    expect(() => saveAsTemplateInputSchema.parse({ ...valid, effectiveFromISO: "2026-05-26" })).toThrow();
  });
  it("rejects malformed selectedShifts entries", () => {
    expect(() => saveAsTemplateInputSchema.parse({ ...valid, selectedShifts: [{ source: "template" }] })).toThrow();
    expect(() => saveAsTemplateInputSchema.parse({ ...valid, selectedShifts: [{ source: "override", templateId: uuid }] })).toThrow();
  });
});

describe("copyWeekInputSchema", () => {
  const valid = {
    classId: uuid,
    sourceWeekStartISO: "2026-05-18",
    targetWeekStartISO: "2026-05-25",
  };
  it("parses valid input", () => {
    expect(() => copyWeekInputSchema.parse(valid)).not.toThrow();
  });
  it("rejects source == target", () => {
    expect(() => copyWeekInputSchema.parse({ ...valid, targetWeekStartISO: valid.sourceWeekStartISO })).toThrow();
  });
  it("rejects non-Monday weeks", () => {
    expect(() => copyWeekInputSchema.parse({ ...valid, sourceWeekStartISO: "2026-05-19" })).toThrow();
    expect(() => copyWeekInputSchema.parse({ ...valid, targetWeekStartISO: "2026-05-26" })).toThrow();
  });
});

describe("upsertEnrollmentForecastInputSchema", () => {
  const valid = { classId: uuid, date: "2026-05-18", expectedStudents: 12 };
  it("parses a valid input", () => {
    expect(() => upsertEnrollmentForecastInputSchema.parse(valid)).not.toThrow();
  });
  it("rejects negative expectedStudents", () => {
    expect(() => upsertEnrollmentForecastInputSchema.parse({ ...valid, expectedStudents: -1 })).toThrow();
  });
  it("rejects non-integer expectedStudents", () => {
    expect(() => upsertEnrollmentForecastInputSchema.parse({ ...valid, expectedStudents: 1.5 })).toThrow();
  });
});

describe("deleteEnrollmentForecastInputSchema", () => {
  it("parses a valid input", () => {
    expect(() => deleteEnrollmentForecastInputSchema.parse({ classId: uuid, date: "2026-05-18" })).not.toThrow();
  });
  it("rejects bad date format", () => {
    expect(() => deleteEnrollmentForecastInputSchema.parse({ classId: uuid, date: "2026/05/18" })).toThrow();
  });
});

describe("enrollmentImportRowSchema", () => {
  it("parses a valid row", () => {
    expect(() => enrollmentImportRowSchema.parse({ date: "2026-05-18", expected_students: 12 })).not.toThrow();
  });
  it("accepts numeric strings (xlsx may return strings)", () => {
    expect(() => enrollmentImportRowSchema.parse({ date: "2026-05-18", expected_students: "12" })).not.toThrow();
  });
  it("rejects negative students", () => {
    expect(() => enrollmentImportRowSchema.parse({ date: "2026-05-18", expected_students: -3 })).toThrow();
  });
  it("rejects non-real date", () => {
    expect(() => enrollmentImportRowSchema.parse({ date: "2026-02-30", expected_students: 12 })).toThrow();
  });
});

describe("commitEnrollmentImportInputSchema", () => {
  it("parses valid input", () => {
    expect(() =>
      commitEnrollmentImportInputSchema.parse({
        classId: uuid,
        sessionId: "any-string-id",
        rows: [{ date: "2026-05-18", expected_students: 12 }],
      }),
    ).not.toThrow();
  });
  it("rejects empty rows", () => {
    expect(() =>
      commitEnrollmentImportInputSchema.parse({ classId: uuid, sessionId: "id", rows: [] }),
    ).toThrow();
  });
});
