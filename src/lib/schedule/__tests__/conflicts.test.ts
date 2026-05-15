import { describe, expect, it } from "vitest";
import { detectShiftConflicts } from "@/lib/schedule/conflicts";
import type {
  ConflictContext,
  ShiftCandidate,
  TemplateCandidate,
} from "@/lib/schedule/types";

const emptyCtx: ConflictContext = {
  crossClassShifts: [],
  crossClassTemplates: [],
  sameClassTemplates: [],
};

const baseShift: ShiftCandidate = {
  kind: "shift",
  classId: "class-a",
  employeeId: "emp-1",
  date: "2026-05-18", // a Monday
  startTime: "09:00",
  endTime: "12:00",
};

const baseTemplate: TemplateCandidate = {
  kind: "template",
  classId: "class-a",
  employeeId: "emp-1",
  dayOfWeek: 0, // Monday
  startTime: "09:00",
  endTime: "12:00",
  effectiveFromISO: "2026-05-18",
};

describe("rule (a) — cross-class overlap", () => {
  it("flags overlapping shift in another class for the same employee + date", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      crossClassShifts: [
        {
          id: "s-other",
          classId: "class-b",
          employeeId: "emp-1",
          date: "2026-05-18",
          startTime: "10:00",
          endTime: "13:00",
        },
      ],
    };
    const out = detectShiftConflicts(baseShift, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ rule: "a", otherClassId: "class-b" });
  });

  it("does not flag adjacent times (open intervals)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      crossClassShifts: [
        { id: "s-other", classId: "class-b", employeeId: "emp-1", date: "2026-05-18", startTime: "12:00", endTime: "15:00" },
      ],
    };
    expect(detectShiftConflicts(baseShift, ctx)).toEqual([]);
  });

  it("flags overlapping cross-class template for a template candidate (open-ended range)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      crossClassTemplates: [
        { id: "t-other", classId: "class-b", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseTemplate, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("a");
  });

  it("flags a future-starting cross-class template whose range overlaps the candidate's open-ended range", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      crossClassTemplates: [
        { id: "t-other", classId: "class-b", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-08-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseTemplate, ctx);
    expect(out).toHaveLength(1);
  });

  it("does not flag a cross-class template that closed before the candidate's effective_from", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      crossClassTemplates: [
        { id: "t-other", classId: "class-b", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2025-01-01", effectiveUntil: "2026-05-17" },
      ],
    };
    expect(detectShiftConflicts(baseTemplate, ctx)).toEqual([]);
  });
});

describe("rule (b) — same class, same slot, two employees", () => {
  it("does not flag two employees in the same time window in the same class (allowed)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      // crossClassShifts is only checked for cross-class; same-class same-time another employee never reaches conflict-detect because the action wouldn't load same-class shifts as cross-class.
      // Defensively confirm: passing a shift_like with the SAME classId but different employee in crossClassShifts would still trigger rule a only if classId differs; here it matches, so it's ignored.
      crossClassShifts: [
        { id: "s-same-class", classId: "class-a", employeeId: "emp-2", date: "2026-05-18", startTime: "09:00", endTime: "12:00" },
      ],
    };
    expect(detectShiftConflicts(baseShift, ctx)).toEqual([]);
  });
});

describe("rule (c) — same class, same employee, overlapping templates, different times", () => {
  it("flags an overlapping same-class template covering the candidate's date", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      sameClassTemplates: [
        { id: "t-overlap", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseShift, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("c");
  });

  it("flags an overlapping same-class template for a template candidate", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      sameClassTemplates: [
        { id: "t-overlap", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseTemplate, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("c");
  });
});

describe("rule (d) — same class, same employee, identical times", () => {
  it("flags identical-time template as rule (d), not (c)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      sameClassTemplates: [
        { id: "t-dup", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "09:00", endTime: "12:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseTemplate, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("d");
  });
});

describe("self-exclusion", () => {
  it("does not flag the row being updated against itself (shift)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      excludeShiftId: "self",
      crossClassShifts: [
        { id: "self", classId: "class-b", employeeId: "emp-1", date: "2026-05-18", startTime: "10:00", endTime: "13:00" },
      ],
    };
    // Even though the cross-class row overlaps, it's excluded by id.
    expect(detectShiftConflicts(baseShift, ctx)).toEqual([]);
  });

  it("does not flag the row being updated against itself (template)", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      excludeTemplateId: "self",
      sameClassTemplates: [
        { id: "self", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    expect(detectShiftConflicts(baseTemplate, ctx)).toEqual([]);
  });
});

describe("replacement override + parent template interaction", () => {
  it("a replacement override candidate does not conflict with the template it replaces (passed via excludeTemplateId)", () => {
    // Setup: an override is being created with sourceTemplateId = T1. The caller passes
    // sameClassTemplates with T1 and excludeTemplateId = T1 to indicate self-suppression.
    const ctx: ConflictContext = {
      ...emptyCtx,
      excludeTemplateId: "T1",
      sameClassTemplates: [
        { id: "T1", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    // The override would normally trigger rule (c) with T1, but excludeTemplateId suppresses it.
    expect(detectShiftConflicts(baseShift, ctx)).toEqual([]);
  });

  it("the same replacement override still conflicts with a different overlapping template T2", () => {
    const ctx: ConflictContext = {
      ...emptyCtx,
      excludeTemplateId: "T1",
      sameClassTemplates: [
        { id: "T1", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
        { id: "T2", classId: "class-a", employeeId: "emp-1", dayOfWeek: 0, startTime: "10:00", endTime: "14:00", effectiveFrom: "2026-01-01", effectiveUntil: null },
      ],
    };
    const out = detectShiftConflicts(baseShift, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ rule: "c", otherTemplateId: "T2" });
  });
});
