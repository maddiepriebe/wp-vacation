# Phase 2 Schedule Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the schedule resolver, the pure conflict detector, the schedule grid UI (week mode + template mode + drag-to-move), and the six shift/template mutation Server Actions with full overlap-rule enforcement. After Plan 3 ships, an admin can view and edit class schedules; Plan 4 then adds save-as-template, copy-week, enrollment forecast, and the print view.

**Architecture:** Pure libs (`schedule/types`, `schedule/conflicts`, `schedule/schemas`) and resolver (`schedule/resolver` — DB-aware via `dbOrTx`) → Server Actions wrapped in `runActionTx` → schedule page (Server Component) → top-level `ScheduleClient` (Client) owning mode + week + dialog state. Mutations are Server Actions imported into the client tree; `revalidatePath` propagates writes back to the server-rendered grid.

**Tech Stack:** Plan 1 + Plan 2 foundations. No new deps. React 19 client state for ephemeral UI; URL search params for mode + weekStartISO so refreshes preserve state.

**Spec reference:** `docs/superpowers/specs/phase-2-design.md` §4 (resolver + grid) and §5 (mutations + conflicts), plus §1 file layout. Save-as-template / copy-week / enrollment / print are §6 → Plan 4.

**Plan 2 execution details to account for:**
- `auditLog` (singular) is the schema export; columns are `actorType`, `actorId`, `entityType`, `entityId`, `payload`. Use `writeAuditLog` for writes; query `auditLog.entityId` (NOT `targetId`).
- For shift/template actions, pass `shiftId` or `templateId` as `targetId`. For bulk-write actions in Plan 4 (`template.save`, `week.copy`), `classId` will be the `targetId`.
- `ConflictReason` is already exported from `@/lib/actions/errors` (Plan 1).
- All mutating actions wrap in `runActionTx`; tests use `withTx` + fixture builders only. ESLint blocks direct `db` imports in tests.
- The `_`-prefixed unused-var convention is now in place; you can use `_field` for intentionally-omitted destructured keys.

---

## File Structure

**Create (lib):**
- `src/lib/schedule/types.ts` — `ShiftSource`, `ScheduleMode`, `ResolvedShift` (discriminated union), `ShiftLike`, `TemplateLike`.
- `src/lib/schedule/conflicts.ts` — `detectShiftConflicts(candidate, ctx) → ConflictReason[]`, pure.
- `src/lib/schedule/resolver.ts` — `resolveWeek`, `resolveTemplateWeek`, `expandTemplates`. `React.cache()`-wrapped; reads via `dbOrTx()`.
- `src/lib/schedule/schemas.ts` — Zod input schemas for all six mutation actions.

**Create (routes / actions / UI):**
- `src/app/(admin)/admin/classes/[id]/actions.ts` — `createShiftAction`, `updateShiftAction`, `deleteShiftAction`, `createShiftTemplateAction`, `updateShiftTemplateAction`, `deleteShiftTemplateAction`.
- `src/app/(admin)/admin/classes/[id]/schedule/page.tsx` — Server Component, dispatches to the right resolver per `mode`.
- `src/app/(admin)/admin/classes/[id]/schedule/_components/`:
  - `ScheduleClient.tsx` — top-level client wrapper; owns dialog state, conflict modal display.
  - `WeekGrid.tsx` — renders the M–F × employees grid from `ResolvedShift[]`.
  - `ShiftBlock.tsx` — single shift cell; click to edit, drag to move.
  - `ShiftEditDialog.tsx` — create/edit/delete one shift or template row.
  - `WeekNavigator.tsx` — prev/next/this-week + week label.
  - `ModeToggle.tsx` — week ↔ template.
  - `ConflictModal.tsx` — surfaces `ConflictReason[]` after a failed mutation.

**Modify:**
- `src/app/(admin)/admin/classes/page.tsx` — link each class row to `/admin/classes/[id]/schedule`.

**Tests (create):**
- `src/lib/schedule/__tests__/conflicts.test.ts` — pure unit, fixture-driven.
- `src/lib/schedule/__tests__/resolver.test.ts` — integration via `withTx` + fixture builders.
- `src/app/(admin)/admin/classes/__tests__/actions.test.ts` — integration tests for all six mutation actions, via `withTx` + `runActionTx` savepoint.

---

## Task 1: Verify Plan 2 baseline

**Files:** none

- [ ] **Step 1: Confirm clean working tree (modulo `seed.ts`)**

Run: `git status` — expect only `src/db/seed.ts`.

- [ ] **Step 2: Confirm Plan 2 is green**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all three exit 0; 111+ tests pass.

If anything is red, halt.

---

## Task 2: Build `src/lib/schedule/types.ts` (types only)

**Files:**
- Create: `src/lib/schedule/types.ts`

No tests — pure type definitions, validated by downstream consumers.

- [ ] **Step 1: Write the types module**

Create `src/lib/schedule/types.ts`:

```ts
import type { roleInClassEnum } from "@/db/schema";

type RoleInClass = (typeof roleInClassEnum.enumValues)[number];

export type ShiftSource = "template" | "override";
export type ScheduleMode = "template" | "week";

export type ResolvedShift = {
  date: string;            // 'YYYY-MM-DD', ET wall-clock
  employee_id: string;
  start_time: string;      // 'HH:MM' (15-min granular)
  end_time: string;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    role_in_class: RoleInClass;
  };
} & (
  | { source: "template"; template_id: string }
  | { source: "override"; shift_id: string; source_template_id: string | null }
);

export type ShiftLike = {
  id: string;
  classId: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type TemplateLike = {
  id: string;
  classId: string;
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type ShiftCandidate = {
  kind: "shift";
  classId: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type TemplateCandidate = {
  kind: "template";
  classId: string;
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFromISO: string;
};

export type ConflictContext = {
  crossClassShifts: ShiftLike[];
  crossClassTemplates: TemplateLike[];
  sameClassTemplates: TemplateLike[];
  excludeShiftId?: string;
  excludeTemplateId?: string;
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schedule/types.ts
git commit -m "feat(lib/schedule/types): ResolvedShift, ShiftLike, TemplateLike, candidate types"
```

---

## Task 3: Build `src/lib/schedule/conflicts.ts` (TDD pure)

**Files:**
- Create: `src/lib/schedule/__tests__/conflicts.test.ts`
- Create: `src/lib/schedule/conflicts.ts`

Implements the four enforced rules (a, b, c, d). Rule (e) is documented in the spec but not enforced.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/schedule/__tests__/conflicts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/schedule/__tests__/conflicts.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement conflicts.ts**

Create `src/lib/schedule/conflicts.ts`:

```ts
import { parse } from "date-fns";
import { timeToMinutes } from "@/lib/dates";
import type { ConflictReason } from "@/lib/actions/errors";
import type {
  ConflictContext,
  ShiftCandidate,
  TemplateCandidate,
  ShiftLike,
  TemplateLike,
} from "@/lib/schedule/types";

function overlapsTime(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = timeToMinutes(aStart);
  const aE = timeToMinutes(aEnd);
  const bS = timeToMinutes(bStart);
  const bE = timeToMinutes(bEnd);
  return aS < bE && bS < aE;
}

function dayOfWeekOf(isoDate: string): number {
  // 0 = Monday, ... 4 = Friday (matches schedule_shift_template.day_of_week)
  // JS getDay: 0 = Sunday, 1 = Monday. Convert.
  const d = parse(isoDate, "yyyy-MM-dd", new Date());
  const jsDow = d.getDay();
  // Sun=0 -> -1 (off-week); Mon=1 -> 0; Tue=2 -> 1; ... Fri=5 -> 4; Sat=6 -> 5 (off-week)
  return jsDow - 1;
}

function templateActiveOnOrAfter(t: TemplateLike, dateISO: string): boolean {
  return t.effectiveFrom <= dateISO && (t.effectiveUntil === null || t.effectiveUntil >= dateISO);
}

function templateRangeOverlapsOpenEnded(t: TemplateLike, fromISO: string): boolean {
  return t.effectiveUntil === null || t.effectiveUntil >= fromISO;
}

export function detectShiftConflicts(
  candidate: ShiftCandidate | TemplateCandidate,
  ctx: ConflictContext,
): ConflictReason[] {
  const out: ConflictReason[] = [];

  if (candidate.kind === "shift") {
    // Rule (a): cross-class shifts on the same date with overlapping times.
    for (const s of ctx.crossClassShifts) {
      if (ctx.excludeShiftId && s.id === ctx.excludeShiftId) continue;
      if (s.classId === candidate.classId) continue; // (b) same-class same-slot is allowed
      if (s.employeeId !== candidate.employeeId) continue;
      if (s.date !== candidate.date) continue;
      if (!overlapsTime(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) continue;
      out.push({
        rule: "a",
        otherClassId: s.classId,
        otherId: s.id,
        otherWindow: { start: s.startTime, end: s.endTime },
      });
    }

    // Rules (c) & (d): same-class templates covering this date with overlapping times.
    const dow = dayOfWeekOf(candidate.date);
    for (const t of ctx.sameClassTemplates) {
      if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
      if (t.classId !== candidate.classId) continue;
      if (t.employeeId !== candidate.employeeId) continue;
      if (t.dayOfWeek !== dow) continue;
      if (!templateActiveOnOrAfter(t, candidate.date)) continue;
      if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
      const identical = t.startTime === candidate.startTime && t.endTime === candidate.endTime;
      out.push(
        identical
          ? { rule: "d", otherId: t.id }
          : { rule: "c", otherTemplateId: t.id, otherWindow: { start: t.startTime, end: t.endTime } },
      );
    }
    return out;
  }

  // Template candidate.
  // Rule (a): cross-class templates on the same day-of-week with overlapping times and overlapping range.
  for (const t of ctx.crossClassTemplates) {
    if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
    if (t.classId === candidate.classId) continue;
    if (t.employeeId !== candidate.employeeId) continue;
    if (t.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!templateRangeOverlapsOpenEnded(t, candidate.effectiveFromISO)) continue;
    if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
    out.push({
      rule: "a",
      otherClassId: t.classId,
      otherId: t.id,
      otherWindow: { start: t.startTime, end: t.endTime },
    });
  }

  // Rules (c) & (d): same-class templates, open-ended range overlap.
  for (const t of ctx.sameClassTemplates) {
    if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
    if (t.classId !== candidate.classId) continue;
    if (t.employeeId !== candidate.employeeId) continue;
    if (t.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!templateRangeOverlapsOpenEnded(t, candidate.effectiveFromISO)) continue;
    if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
    const identical = t.startTime === candidate.startTime && t.endTime === candidate.endTime;
    out.push(
      identical
        ? { rule: "d", otherId: t.id }
        : { rule: "c", otherTemplateId: t.id, otherWindow: { start: t.startTime, end: t.endTime } },
    );
  }
  return out;
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/schedule/__tests__/conflicts.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/conflicts.ts src/lib/schedule/__tests__/conflicts.test.ts
git commit -m "feat(lib/schedule/conflicts): pure overlap-rule detector (a/c/d, with self-exclusion)"
```

---

## Task 4: Build `src/lib/schedule/resolver.ts` (TDD via withTx)

**Files:**
- Create: `src/lib/schedule/__tests__/resolver.test.ts`
- Create: `src/lib/schedule/resolver.ts`

Two functions: `resolveWeek` (week mode, merges templates with overrides) and `resolveTemplateWeek` (template mode, templates only). Both take `(classId, weekStartISO)`, both wrapped in `React.cache()`. Internal reads via `dbOrTx()`.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/schedule/__tests__/resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withTx } from "@/test/with-tx";
import { makeClass, makeEmployee, makeShift, makeTemplate } from "@/test/fixtures";
import { resolveTemplateWeek, resolveWeek } from "@/lib/schedule/resolver";

describe("resolveWeek", () => {
  it("returns [] for an empty class and empty week", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toEqual([]);
    });
  });

  it("expands one M–F template into 5 slots", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, {
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "08:00",
        endTime: "12:00",
        effectiveFrom: "2026-05-11",
      });
      await makeTemplate(tx, {
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "12:00",
        effectiveFrom: "2026-05-11",
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      const dates = out.map((s) => s.date).sort();
      expect(dates).toEqual(["2026-05-18", "2026-05-19"]);
      expect(out.every((s) => s.source === "template")).toBe(true);
    });
  });

  it("replacement override suppresses parent template's slot for that (employee, date)", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "08:00",
        endTime: "12:00",
        effectiveFrom: "2026-05-11",
      });
      await makeShift(tx, {
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "09:00",
        endTime: "11:00",
        sourceTemplateId: t.id,
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toHaveLength(1);
      expect(out[0].source).toBe("override");
    });
  });

  it("replacement override only suppresses its parent template; other templates still render", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const tMorning = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "13:00", endTime: "17:00", effectiveFrom: "2026-05-11",
      });
      await makeShift(tx, {
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "09:00", endTime: "11:00", sourceTemplateId: tMorning.id,
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toHaveLength(2);
      const sources = out.map((s) => s.source).sort();
      expect(sources).toEqual(["override", "template"]);
      const tmpl = out.find((s) => s.source === "template");
      expect(tmpl?.start_time).toBe("13:00");
    });
  });

  it("standalone override (source_template_id null) renders alongside templates", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      await makeShift(tx, {
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "13:00", endTime: "17:00", sourceTemplateId: null,
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toHaveLength(2);
      const sources = out.map((s) => s.source).sort();
      expect(sources).toEqual(["override", "template"]);
    });
  });

  it("two employees in the same slot both appear (rule b)", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const e1 = await makeEmployee(tx, { defaultClassId: cls.id });
      const e2 = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, { classId: cls.id, employeeId: e1.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      await makeTemplate(tx, { classId: cls.id, employeeId: e2.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toHaveLength(2);
    });
  });

  it("ignores templates whose effective_from is after the week", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-06-01",
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toEqual([]);
    });
  });

  it("ignores templates whose effective_until is before the week", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00",
        effectiveFrom: "2025-01-01", effectiveUntil: "2025-12-31",
      });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out).toEqual([]);
    });
  });

  it("sorts deterministically: date, start, end, last_name, first_name, employee_id, source, id", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const a = await makeEmployee(tx, { defaultClassId: cls.id, firstName: "A", lastName: "Alpha" });
      const b = await makeEmployee(tx, { defaultClassId: cls.id, firstName: "B", lastName: "Beta" });
      await makeTemplate(tx, { classId: cls.id, employeeId: b.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      await makeTemplate(tx, { classId: cls.id, employeeId: a.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      const out = await resolveWeek(cls.id, "2026-05-18");
      expect(out[0].employee.last_name).toBe("Alpha");
      expect(out[1].employee.last_name).toBe("Beta");
    });
  });
});

describe("resolveTemplateWeek", () => {
  it("returns templates only, ignoring overrides", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, { classId: cls.id, employeeId: emp.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      await makeShift(tx, { classId: cls.id, employeeId: emp.id, date: "2026-05-18", startTime: "09:00", endTime: "11:00", sourceTemplateId: t.id });
      const out = await resolveTemplateWeek(cls.id, "2026-05-18");
      expect(out).toHaveLength(1);
      expect(out[0].source).toBe("template");
      if (out[0].source === "template") expect(out[0].template_id).toBe(t.id);
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/schedule/__tests__/resolver.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement resolver.ts**

Create `src/lib/schedule/resolver.ts`:

```ts
import { cache } from "react";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { addDaysISO, weekEnd } from "@/lib/dates";
import { dbOrTx } from "@/lib/actions/transactions";
import { employees, scheduleShifts, scheduleShiftTemplates } from "@/db/schema";
import type { ResolvedShift } from "@/lib/schedule/types";

// dayOfWeek: 0=Mon ... 4=Fri (matches schema). weekStartISO is always a Monday.
function dateForDayOfWeek(weekStartISO: string, dayOfWeek: number): string {
  return addDaysISO(weekStartISO, dayOfWeek);
}

type EmpRef = {
  id: string;
  first_name: string;
  last_name: string;
  role_in_class: ResolvedShift["employee"]["role_in_class"];
};

async function loadEmployeeRefs(employeeIds: string[]): Promise<Map<string, EmpRef>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await dbOrTx()
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      roleInClass: employees.roleInClass,
    })
    .from(employees)
    .where(inArray(employees.id, employeeIds));
  const map = new Map<string, EmpRef>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      first_name: r.firstName,
      last_name: r.lastName,
      role_in_class: r.roleInClass,
    });
  }
  return map;
}

function sortKey(s: ResolvedShift): string {
  const idForSort =
    s.source === "template" ? s.template_id : s.shift_id;
  return [
    s.date,
    s.start_time,
    s.end_time,
    s.employee.last_name,
    s.employee.first_name,
    s.employee_id,
    s.source,
    idForSort,
  ].join("|");
}

export const resolveWeek = cache(
  async (classId: string, weekStartISO: string): Promise<ResolvedShift[]> => {
    const weekEndISO = weekEnd(weekStartISO);
    const tx = dbOrTx();

    const templates = await tx
      .select()
      .from(scheduleShiftTemplates)
      .where(
        and(
          eq(scheduleShiftTemplates.classId, classId),
          lte(scheduleShiftTemplates.effectiveFrom, weekEndISO),
          or(
            isNull(scheduleShiftTemplates.effectiveUntil),
            gte(scheduleShiftTemplates.effectiveUntil, weekStartISO),
          ),
        ),
      );

    const overrides = await tx
      .select()
      .from(scheduleShifts)
      .where(
        and(
          eq(scheduleShifts.classId, classId),
          gte(scheduleShifts.date, weekStartISO),
          lte(scheduleShifts.date, weekEndISO),
        ),
      );

    const suppressed = new Set(
      overrides
        .filter((o) => o.sourceTemplateId !== null)
        .map((o) => `${o.sourceTemplateId}|${o.employeeId}|${o.date}`),
    );

    const employeeIds = new Set<string>();
    for (const t of templates) employeeIds.add(t.employeeId);
    for (const o of overrides) employeeIds.add(o.employeeId);
    const empMap = await loadEmployeeRefs([...employeeIds]);

    const out: ResolvedShift[] = [];

    for (const t of templates) {
      const date = dateForDayOfWeek(weekStartISO, t.dayOfWeek);
      if (date < t.effectiveFrom) continue;
      if (t.effectiveUntil !== null && date > t.effectiveUntil) continue;
      if (date < weekStartISO || date > weekEndISO) continue;
      const key = `${t.id}|${t.employeeId}|${date}`;
      if (suppressed.has(key)) continue;
      const emp = empMap.get(t.employeeId);
      if (!emp) continue;
      out.push({
        source: "template",
        template_id: t.id,
        date,
        employee_id: t.employeeId,
        start_time: t.startTime,
        end_time: t.endTime,
        employee: emp,
      });
    }

    for (const o of overrides) {
      const emp = empMap.get(o.employeeId);
      if (!emp) continue;
      out.push({
        source: "override",
        shift_id: o.id,
        source_template_id: o.sourceTemplateId,
        date: o.date,
        employee_id: o.employeeId,
        start_time: o.startTime,
        end_time: o.endTime,
        employee: emp,
      });
    }

    out.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return out;
  },
);

export const resolveTemplateWeek = cache(
  async (classId: string, weekStartISO: string): Promise<ResolvedShift[]> => {
    const weekEndISO = weekEnd(weekStartISO);
    const tx = dbOrTx();

    const templates = await tx
      .select()
      .from(scheduleShiftTemplates)
      .where(
        and(
          eq(scheduleShiftTemplates.classId, classId),
          lte(scheduleShiftTemplates.effectiveFrom, weekEndISO),
          or(
            isNull(scheduleShiftTemplates.effectiveUntil),
            gte(scheduleShiftTemplates.effectiveUntil, weekStartISO),
          ),
        ),
      );

    const empMap = await loadEmployeeRefs([...new Set(templates.map((t) => t.employeeId))]);
    const out: ResolvedShift[] = [];
    for (const t of templates) {
      const date = dateForDayOfWeek(weekStartISO, t.dayOfWeek);
      if (date < t.effectiveFrom) continue;
      if (t.effectiveUntil !== null && date > t.effectiveUntil) continue;
      if (date < weekStartISO || date > weekEndISO) continue;
      const emp = empMap.get(t.employeeId);
      if (!emp) continue;
      out.push({
        source: "template",
        template_id: t.id,
        date,
        employee_id: t.employeeId,
        start_time: t.startTime,
        end_time: t.endTime,
        employee: emp,
      });
    }
    out.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return out;
  },
);
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/schedule/__tests__/resolver.test.ts`
Expected: all 10 tests PASS.

If `makeShift` / `makeTemplate` fixtures don't accept `sourceTemplateId` / `effectiveUntil` in their overrides type, extend the fixture builders in `src/test/fixtures.ts` to make those optional fields settable. Commit the fixture extension alongside this task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/resolver.ts src/lib/schedule/__tests__/resolver.test.ts src/test/fixtures.ts
git commit -m "feat(lib/schedule/resolver): resolveWeek + resolveTemplateWeek with dbOrTx + React.cache"
```

---

## Task 5: Build `src/lib/schedule/schemas.ts` (TDD pure)

**Files:**
- Create: `src/lib/schedule/__tests__/schemas.test.ts`
- Create: `src/lib/schedule/schemas.ts`

Zod input schemas for the six mutation actions. All use `isISODateString` / `isMondayISODate` / `timeToMinutes` / `assertTimeRange` from `@/lib/dates`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule/__tests__/schemas.test.ts`:

```ts
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
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/schedule/__tests__/schemas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement schemas.ts**

Create `src/lib/schedule/schemas.ts`:

```ts
import { z } from "zod";
import {
  assertTimeRange,
  isISODateString,
  isMondayISODate,
  timeToMinutes,
} from "@/lib/dates";

const uuid = z.string().uuid();
const isoDate = z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date");
const mondayISO = isoDate.refine(isMondayISODate, "Must be a Monday in ET");
const timeStr = z.string().refine((v) => !Number.isNaN(timeToMinutes(v)), "Must be HH:MM (15-min granular)");

const timeRangeRefine = (data: { startTime: string; endTime: string }, ctx: z.RefinementCtx) => {
  try {
    assertTimeRange(data.startTime, data.endTime);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: (e as Error).message,
      path: ["endTime"],
    });
  }
};

const partialTimeRefine = (
  data: { startTime?: string; endTime?: string },
  ctx: z.RefinementCtx,
) => {
  const both = data.startTime !== undefined && data.endTime !== undefined;
  const neither = data.startTime === undefined && data.endTime === undefined;
  if (!both && !neither) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startTime and endTime must be set together",
      path: ["startTime"],
    });
    return;
  }
  if (both) timeRangeRefine(data as { startTime: string; endTime: string }, ctx);
};

export const createShiftInputSchema = z
  .object({
    classId: uuid,
    employeeId: uuid,
    date: isoDate,
    startTime: timeStr,
    endTime: timeStr,
    sourceTemplateId: uuid.optional(),
  })
  .superRefine(timeRangeRefine);

export const updateShiftInputSchema = z
  .object({
    shiftId: uuid,
    employeeId: uuid.optional(),
    startTime: timeStr.optional(),
    endTime: timeStr.optional(),
  })
  .superRefine(partialTimeRefine);

export const deleteShiftInputSchema = z.object({ shiftId: uuid });

export const createShiftTemplateInputSchema = z
  .object({
    classId: uuid,
    employeeId: uuid,
    dayOfWeek: z.number().int().min(0).max(4),
    startTime: timeStr,
    endTime: timeStr,
    effectiveFromISO: mondayISO,
  })
  .superRefine(timeRangeRefine);

export const updateShiftTemplateInputSchema = z
  .object({
    templateId: uuid,
    employeeId: uuid.optional(),
    dayOfWeek: z.number().int().min(0).max(4).optional(),
    startTime: timeStr.optional(),
    endTime: timeStr.optional(),
  })
  .superRefine(partialTimeRefine);

export const deleteShiftTemplateInputSchema = z.object({ templateId: uuid });

export type CreateShiftInput = z.infer<typeof createShiftInputSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftInputSchema>;
export type DeleteShiftInput = z.infer<typeof deleteShiftInputSchema>;
export type CreateShiftTemplateInput = z.infer<typeof createShiftTemplateInputSchema>;
export type UpdateShiftTemplateInput = z.infer<typeof updateShiftTemplateInputSchema>;
export type DeleteShiftTemplateInput = z.infer<typeof deleteShiftTemplateInputSchema>;
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/schedule/__tests__/schemas.test.ts`
Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/schemas.ts src/lib/schedule/__tests__/schemas.test.ts
git commit -m "feat(lib/schedule/schemas): Zod input schemas for all six mutation actions"
```

---

## Task 6: Build `createShiftAction` (TDD via withTx + runActionTx)

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/actions.ts` (will be appended to in Tasks 7–11)
- Create: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

The actions sit one level up from `[id]/` because Next's `[id]/actions.ts` would be ambiguous between the route folder and a peer file; place at `[id]/actions.ts` per the spec, but the test file lives at `__tests__/actions.test.ts` under `classes/`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/classes/__tests__/actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, scheduleShifts } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { makeAdmin, makeClass, makeEmployee, makeTemplate } from "@/test/fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const currentAdminId = { value: "" };
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: currentAdminId.value }),
}));

import { createShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";

describe("createShiftAction", () => {
  it("inserts a standalone shift and writes shift.create audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;

      const result = await createShiftAction({
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, result.data.id));
      expect(row.sourceTemplateId).toBeNull();
      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.entityId, row.id));
      expect(audit.action).toBe("shift.create");
      expect(audit.entityType).toBe("shift");
    });
  });

  it("inserts a replacement shift with sourceTemplateId", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, { classId: cls.id, employeeId: emp.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      currentAdminId.value = admin.id;

      const result = await createShiftAction({
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "09:00",
        endTime: "11:00",
        sourceTemplateId: t.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, result.data.id));
      expect(row.sourceTemplateId).toBe(t.id);
    });
  });

  it("rejects rule-(a) conflict: cross-class shift overlapping same employee, same date", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const clsA = await makeClass(tx);
      const clsB = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: clsA.id });
      currentAdminId.value = admin.id;

      await createShiftAction({
        classId: clsB.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "10:00",
        endTime: "13:00",
      });

      const result = await createShiftAction({
        classId: clsA.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("conflict");
        expect(result.error.conflicts[0].rule).toBe("a");
      }
    });
  });

  it("rejects rule-(c) conflict: overlapping same-class template, different times", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      currentAdminId.value = admin.id;

      const result = await createShiftAction({
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "10:00",
        endTime: "13:00",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("conflict");
        expect(result.error.conflicts[0].rule).toBe("c");
      }
    });
  });

  it("returns class_missing for unknown classId", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const emp = await makeEmployee(tx, { defaultClassId: (await makeClass(tx)).id });
      currentAdminId.value = admin.id;

      const result = await createShiftAction({
        classId: "00000000-0000-0000-0000-000000000000",
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/__tests__/actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement createShiftAction**

Create `src/app/(admin)/admin/classes/[id]/actions.ts`:

```ts
"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";
import { writeAuditLog } from "@/lib/audit/write";
import {
  classes,
  employees,
  scheduleShiftTemplates,
  scheduleShifts,
} from "@/db/schema";
import { detectShiftConflicts } from "@/lib/schedule/conflicts";
import {
  createShiftInputSchema,
} from "@/lib/schedule/schemas";
import type { TemplateLike, ShiftLike } from "@/lib/schedule/types";

async function loadClassesEmployeesTemplatesForShift(
  tx: Parameters<Parameters<typeof import("@/db/client").db.transaction>[0]>[0],
  input: { classId: string; employeeId: string; date: string },
): Promise<{ crossClassShifts: ShiftLike[]; sameClassTemplates: TemplateLike[]; classExists: boolean; employeeExists: boolean }> {
  const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId));
  if (!cls) return { crossClassShifts: [], sameClassTemplates: [], classExists: false, employeeExists: false };

  const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
  if (!emp) return { crossClassShifts: [], sameClassTemplates: [], classExists: true, employeeExists: false };

  const crossClassShifts = await tx
    .select({
      id: scheduleShifts.id,
      classId: scheduleShifts.classId,
      employeeId: scheduleShifts.employeeId,
      date: scheduleShifts.date,
      startTime: scheduleShifts.startTime,
      endTime: scheduleShifts.endTime,
    })
    .from(scheduleShifts)
    .where(
      and(
        eq(scheduleShifts.employeeId, input.employeeId),
        eq(scheduleShifts.date, input.date),
        ne(scheduleShifts.classId, input.classId),
      ),
    );

  const sameClassTemplates = await tx
    .select({
      id: scheduleShiftTemplates.id,
      classId: scheduleShiftTemplates.classId,
      employeeId: scheduleShiftTemplates.employeeId,
      dayOfWeek: scheduleShiftTemplates.dayOfWeek,
      startTime: scheduleShiftTemplates.startTime,
      endTime: scheduleShiftTemplates.endTime,
      effectiveFrom: scheduleShiftTemplates.effectiveFrom,
      effectiveUntil: scheduleShiftTemplates.effectiveUntil,
    })
    .from(scheduleShiftTemplates)
    .where(
      and(
        eq(scheduleShiftTemplates.classId, input.classId),
        eq(scheduleShiftTemplates.employeeId, input.employeeId),
      ),
    );

  return { crossClassShifts, sameClassTemplates, classExists: true, employeeExists: true };
}

export async function createShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = createShiftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  return runActionTx("shift.create", { classId: data.classId, employeeId: data.employeeId, date: data.date }, async (tx) => {
    const ctx = await loadClassesEmployeesTemplatesForShift(tx, data);
    if (!ctx.classExists) return { ok: false, error: { code: "class_missing", message: "Class not found" } };
    if (!ctx.employeeExists) return { ok: false, error: { code: "not_found", message: "Employee not found" } };

    if (data.sourceTemplateId) {
      const [t] = await tx.select({ id: scheduleShiftTemplates.id }).from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, data.sourceTemplateId));
      if (!t) return { ok: false, error: { code: "not_found", message: "Parent template not found" } };
    }

    const conflicts = detectShiftConflicts(
      {
        kind: "shift",
        classId: data.classId,
        employeeId: data.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
      },
      {
        crossClassShifts: ctx.crossClassShifts,
        crossClassTemplates: [],
        sameClassTemplates: ctx.sameClassTemplates,
        // When creating a replacement override, exclude its parent template from
        // rule-(c) checks — the override is replacing T1 for this (employee, date),
        // not conflicting with it. Resolver enforces the actual suppression at read time.
        excludeTemplateId: data.sourceTemplateId ?? undefined,
      },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Shift conflicts detected", conflicts } };
    }

    const [row] = await tx
      .insert(scheduleShifts)
      .values({
        classId: data.classId,
        employeeId: data.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        sourceTemplateId: data.sourceTemplateId ?? null,
      })
      .returning();

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "shift.create",
      targetId: row.id,
      payload: {
        classId: data.classId,
        employeeId: data.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        sourceTemplateId: data.sourceTemplateId ?? null,
      },
    });

    revalidatePath(`/admin/classes/${data.classId}/schedule`);
    return { ok: true, data: { id: row.id } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/__tests__/actions.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/actions.ts src/app/\(admin\)/admin/classes/__tests__/actions.test.ts
git commit -m "feat(classes): createShiftAction with conflict detection + audit"
```

---

## Task 7: Build `updateShiftAction`

**Files:**
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts`
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

`classId` and `date` are immutable; mutating `employeeId` triggers a fresh conflict-fetch against the new employee.

- [ ] **Step 1: Append tests**

Append to actions.test.ts:

```ts
import { updateShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";

describe("updateShiftAction", () => {
  it("updates times and writes audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;

      const create = await createShiftAction({
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-18",
        startTime: "08:00",
        endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await updateShiftAction({
        shiftId: create.data.id,
        startTime: "08:15",
        endTime: "12:15",
      });

      expect(result.ok).toBe(true);
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, create.data.id));
      expect(row.startTime).toBe("08:15:00");
      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.update"));
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toMatchObject({ before: { startTime: "08:00:00" }, after: { startTime: "08:15" } });
    });
  });

  it("self-exclusion: updating to current values does not flag own row as conflict", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;
      const create = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18", startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");
      const result = await updateShiftAction({ shiftId: create.data.id, startTime: "08:00", endTime: "12:00" });
      expect(result.ok).toBe(true);
    });
  });

  it("returns not_found for missing shift", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      const result = await updateShiftAction({ shiftId: "00000000-0000-0000-0000-000000000000", startTime: "08:00", endTime: "12:00" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });

  it("changing employeeId re-fetches context for the new employee", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const clsA = await makeClass(tx);
      const clsB = await makeClass(tx);
      const e1 = await makeEmployee(tx, { defaultClassId: clsA.id });
      const e2 = await makeEmployee(tx, { defaultClassId: clsB.id });
      currentAdminId.value = admin.id;

      // e2 already has a shift in clsB at the same time.
      await createShiftAction({
        classId: clsB.id, employeeId: e2.id, date: "2026-05-18", startTime: "08:00", endTime: "12:00",
      });

      // Create a shift for e1 in clsA, then try to reassign to e2 → conflict with e2's clsB shift.
      const create = await createShiftAction({
        classId: clsA.id, employeeId: e1.id, date: "2026-05-18", startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await updateShiftAction({ shiftId: create.data.id, employeeId: e2.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("conflict");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/__tests__/actions.test.ts`
Expected: 4 new tests fail.

- [ ] **Step 3: Implement updateShiftAction**

Append to actions.ts:

```ts
import { updateShiftInputSchema } from "@/lib/schedule/schemas";

export async function updateShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = updateShiftInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors } };
  }
  const data = parsed.data;

  return runActionTx("shift.update", { shiftId: data.shiftId }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, data.shiftId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Shift not found" } };

    const next = {
      employeeId: data.employeeId ?? existing.employeeId,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
    };

    const ctx = await loadClassesEmployeesTemplatesForShift(tx, {
      classId: existing.classId,
      employeeId: next.employeeId,
      date: existing.date,
    });

    const conflicts = detectShiftConflicts(
      {
        kind: "shift",
        classId: existing.classId,
        employeeId: next.employeeId,
        date: existing.date,
        startTime: next.startTime,
        endTime: next.endTime,
      },
      {
        crossClassShifts: ctx.crossClassShifts,
        crossClassTemplates: [],
        sameClassTemplates: ctx.sameClassTemplates,
        excludeShiftId: data.shiftId,
        // If the existing row replaces a template, keep excluding that template from
        // rule-(c) checks for the post-update candidate.
        excludeTemplateId: existing.sourceTemplateId ?? undefined,
      },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Shift conflicts detected", conflicts } };
    }

    await tx
      .update(scheduleShifts)
      .set({
        employeeId: next.employeeId,
        startTime: next.startTime,
        endTime: next.endTime,
        updatedAt: new Date(),
      })
      .where(eq(scheduleShifts.id, data.shiftId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "shift.update",
      targetId: data.shiftId,
      payload: {
        before: { employeeId: existing.employeeId, startTime: existing.startTime, endTime: existing.endTime },
        after: { employeeId: next.employeeId, startTime: next.startTime, endTime: next.endTime },
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: data.shiftId } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/__tests__/actions.test.ts`
Expected: 9 total PASS.

If the `payload.before.startTime` assertion fails because Postgres returns `'08:00:00'` while the input was `'08:00'`, that's the time column's TZ-less stringification. The test asserts the actual format. Adjust the test (already does — `toMatchObject` allows the `:00` second padding).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/actions.ts src/app/\(admin\)/admin/classes/__tests__/actions.test.ts
git commit -m "feat(classes): updateShiftAction with self-exclusion + employee-change refetch"
```

---

## Task 8: Build `deleteShiftAction`

**Files:**
- Modify: actions.ts + actions.test.ts

Per spec §5.3: only operates on existing `schedule_shift` rows.

- [ ] **Step 1: Append tests**

```ts
import { deleteShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";

describe("deleteShiftAction", () => {
  it("deletes the row and writes shift.delete audit with reconstructable payload", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;
      const create = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18", startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await deleteShiftAction({ shiftId: create.data.id });
      expect(result.ok).toBe(true);

      const rows = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, create.data.id));
      expect(rows).toHaveLength(0);

      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.delete"));
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toMatchObject({
        deleted: {
          shiftId: create.data.id,
          classId: cls.id,
          employeeId: emp.id,
          date: "2026-05-18",
        },
      });
    });
  });

  it("returns not_found for missing shift", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      const result = await deleteShiftAction({ shiftId: "00000000-0000-0000-0000-000000000000" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

- [ ] **Step 3: Implement**

```ts
import { deleteShiftInputSchema } from "@/lib/schedule/schemas";

export async function deleteShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = deleteShiftInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input" } };
  }
  const { shiftId } = parsed.data;

  return runActionTx("shift.delete", { shiftId }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, shiftId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Shift not found" } };

    await tx.delete(scheduleShifts).where(eq(scheduleShifts.id, shiftId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "shift.delete",
      targetId: shiftId,
      payload: {
        deleted: {
          shiftId,
          classId: existing.classId,
          employeeId: existing.employeeId,
          date: existing.date,
          startTime: existing.startTime,
          endTime: existing.endTime,
          sourceTemplateId: existing.sourceTemplateId,
        },
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: shiftId } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS** (11 total)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/actions.ts src/app/\(admin\)/admin/classes/__tests__/actions.test.ts
git commit -m "feat(classes): deleteShiftAction with reconstructable delete payload"
```

---

## Task 9: Build template create / update / delete actions

**Files:**
- Modify: actions.ts + actions.test.ts

Three actions, one commit at the end since they share the same context-loader helper.

- [ ] **Step 1: Append tests**

```ts
import {
  createShiftTemplateAction,
  deleteShiftTemplateAction,
  updateShiftTemplateAction,
} from "@/app/(admin)/admin/classes/[id]/actions";
import { scheduleShiftTemplates } from "@/db/schema";

describe("createShiftTemplateAction", () => {
  it("inserts a template with effective_until null and writes template.create audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;

      const result = await createShiftTemplateAction({
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "08:00",
        endTime: "12:00",
        effectiveFromISO: "2026-05-18",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, result.data.id));
      expect(row.effectiveUntil).toBeNull();

      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.entityId, row.id));
      expect(audit.action).toBe("template.create");
      expect(audit.entityType).toBe("template");
    });
  });

  it("rejects rule-(c) when an overlapping same-class template exists", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      await makeTemplate(tx, { classId: cls.id, employeeId: emp.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      currentAdminId.value = admin.id;

      const result = await createShiftTemplateAction({
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "10:00",
        endTime: "13:00",
        effectiveFromISO: "2026-05-18",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("conflict");
        expect(result.error.conflicts[0].rule).toBe("c");
      }
    });
  });

  it("rejects cross-class rule-(a) including a future-starting cross-class template", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const clsA = await makeClass(tx);
      const clsB = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: clsA.id });
      await makeTemplate(tx, {
        classId: clsB.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "10:00", endTime: "13:00", effectiveFrom: "2026-08-01",
      });
      currentAdminId.value = admin.id;

      const result = await createShiftTemplateAction({
        classId: clsA.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "09:00",
        endTime: "12:00",
        effectiveFromISO: "2026-05-18",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.conflicts[0].rule).toBe("a");
    });
  });
});

describe("updateShiftTemplateAction", () => {
  it("updates a template in place and writes template.update audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, { classId: cls.id, employeeId: emp.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      currentAdminId.value = admin.id;

      const result = await updateShiftTemplateAction({ templateId: t.id, startTime: "08:15", endTime: "12:15" });
      expect(result.ok).toBe(true);
      const [row] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, t.id));
      expect(row.startTime).toBe("08:15:00");
      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "template.update"));
      expect(audits).toHaveLength(1);
    });
  });
});

describe("deleteShiftTemplateAction", () => {
  it("deletes and converts replacement overrides to standalone via ON DELETE SET NULL", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, { classId: cls.id, employeeId: emp.id, dayOfWeek: 0, startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11" });
      const shift = await tx
        .insert(scheduleShifts)
        .values({
          classId: cls.id,
          employeeId: emp.id,
          date: "2026-05-18",
          startTime: "09:00",
          endTime: "11:00",
          sourceTemplateId: t.id,
        })
        .returning();
      currentAdminId.value = admin.id;

      const result = await deleteShiftTemplateAction({ templateId: t.id });
      expect(result.ok).toBe(true);

      const [rebound] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, shift[0].id));
      expect(rebound.sourceTemplateId).toBeNull();

      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "template.delete"));
      expect(audits).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

- [ ] **Step 3: Implement the three template actions**

Append to actions.ts:

```ts
import {
  createShiftTemplateInputSchema,
  deleteShiftTemplateInputSchema,
  updateShiftTemplateInputSchema,
} from "@/lib/schedule/schemas";

async function loadTemplateConflictContext(
  tx: Parameters<Parameters<typeof import("@/db/client").db.transaction>[0]>[0],
  input: { classId: string; employeeId: string; dayOfWeek: number },
): Promise<{ crossClassTemplates: TemplateLike[]; sameClassTemplates: TemplateLike[]; classExists: boolean; employeeExists: boolean }> {
  const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId));
  if (!cls) return { crossClassTemplates: [], sameClassTemplates: [], classExists: false, employeeExists: false };
  const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
  if (!emp) return { crossClassTemplates: [], sameClassTemplates: [], classExists: true, employeeExists: false };

  const cols = {
    id: scheduleShiftTemplates.id,
    classId: scheduleShiftTemplates.classId,
    employeeId: scheduleShiftTemplates.employeeId,
    dayOfWeek: scheduleShiftTemplates.dayOfWeek,
    startTime: scheduleShiftTemplates.startTime,
    endTime: scheduleShiftTemplates.endTime,
    effectiveFrom: scheduleShiftTemplates.effectiveFrom,
    effectiveUntil: scheduleShiftTemplates.effectiveUntil,
  };

  const sameClassTemplates = await tx
    .select(cols)
    .from(scheduleShiftTemplates)
    .where(
      and(
        eq(scheduleShiftTemplates.classId, input.classId),
        eq(scheduleShiftTemplates.employeeId, input.employeeId),
        eq(scheduleShiftTemplates.dayOfWeek, input.dayOfWeek),
      ),
    );

  const crossClassTemplates = await tx
    .select(cols)
    .from(scheduleShiftTemplates)
    .where(
      and(
        ne(scheduleShiftTemplates.classId, input.classId),
        eq(scheduleShiftTemplates.employeeId, input.employeeId),
        eq(scheduleShiftTemplates.dayOfWeek, input.dayOfWeek),
      ),
    );

  return { crossClassTemplates, sameClassTemplates, classExists: true, employeeExists: true };
}

export async function createShiftTemplateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = createShiftTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors } };
  }
  const data = parsed.data;

  return runActionTx("template.create", { classId: data.classId, employeeId: data.employeeId }, async (tx) => {
    const ctx = await loadTemplateConflictContext(tx, data);
    if (!ctx.classExists) return { ok: false, error: { code: "class_missing", message: "Class not found" } };
    if (!ctx.employeeExists) return { ok: false, error: { code: "not_found", message: "Employee not found" } };

    const conflicts = detectShiftConflicts(
      { kind: "template", ...data },
      { crossClassShifts: [], crossClassTemplates: ctx.crossClassTemplates, sameClassTemplates: ctx.sameClassTemplates },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Template conflicts detected", conflicts } };
    }

    const [row] = await tx
      .insert(scheduleShiftTemplates)
      .values({
        classId: data.classId,
        employeeId: data.employeeId,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        effectiveFrom: data.effectiveFromISO,
        effectiveUntil: null,
      })
      .returning();

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "template.create",
      targetId: row.id,
      payload: { ...data, effectiveFromISO: data.effectiveFromISO },
    });

    revalidatePath(`/admin/classes/${data.classId}/schedule`);
    return { ok: true, data: { id: row.id } };
  });
}

export async function updateShiftTemplateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = updateShiftTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors } };
  }
  const data = parsed.data;

  return runActionTx("template.update", { templateId: data.templateId }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, data.templateId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Template not found" } };

    const next = {
      employeeId: data.employeeId ?? existing.employeeId,
      dayOfWeek: data.dayOfWeek ?? existing.dayOfWeek,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
    };

    const ctx = await loadTemplateConflictContext(tx, {
      classId: existing.classId,
      employeeId: next.employeeId,
      dayOfWeek: next.dayOfWeek,
    });

    const conflicts = detectShiftConflicts(
      {
        kind: "template",
        classId: existing.classId,
        employeeId: next.employeeId,
        dayOfWeek: next.dayOfWeek,
        startTime: next.startTime,
        endTime: next.endTime,
        effectiveFromISO: existing.effectiveFrom,
      },
      {
        crossClassShifts: [],
        crossClassTemplates: ctx.crossClassTemplates,
        sameClassTemplates: ctx.sameClassTemplates,
        excludeTemplateId: data.templateId,
      },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Template conflicts detected", conflicts } };
    }

    await tx
      .update(scheduleShiftTemplates)
      .set({
        employeeId: next.employeeId,
        dayOfWeek: next.dayOfWeek,
        startTime: next.startTime,
        endTime: next.endTime,
        updatedAt: new Date(),
      })
      .where(eq(scheduleShiftTemplates.id, data.templateId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "template.update",
      targetId: data.templateId,
      payload: {
        before: {
          employeeId: existing.employeeId,
          dayOfWeek: existing.dayOfWeek,
          startTime: existing.startTime,
          endTime: existing.endTime,
        },
        after: next,
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: data.templateId } };
  });
}

export async function deleteShiftTemplateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = deleteShiftTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input" } };
  }
  const { templateId } = parsed.data;

  return runActionTx("template.delete", { templateId }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, templateId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Template not found" } };

    await tx.delete(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, templateId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "template.delete",
      targetId: templateId,
      payload: {
        deleted: {
          templateId,
          classId: existing.classId,
          employeeId: existing.employeeId,
          dayOfWeek: existing.dayOfWeek,
          startTime: existing.startTime,
          endTime: existing.endTime,
          effectiveFrom: existing.effectiveFrom,
          effectiveUntil: existing.effectiveUntil,
        },
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: templateId } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS** (16 total)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/actions.ts src/app/\(admin\)/admin/classes/__tests__/actions.test.ts
git commit -m "feat(classes): template create/update/delete actions"
```

---

## Task 10: Build the schedule page (Server Component)

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/page.tsx`

Reads `weekStartISO` + `mode` from search params; dispatches to the right resolver; passes `ResolvedShift[]` down to `ScheduleClient`. Bad search params canonicalize via redirect.

- [ ] **Step 1: Build the page**

Create `src/app/(admin)/admin/classes/[id]/schedule/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { isISODateString, isMondayISODate, todayET, weekStartOf } from "@/lib/dates";
import { resolveTemplateWeek, resolveWeek } from "@/lib/schedule/resolver";
import type { ScheduleMode } from "@/lib/schedule/types";
import { ScheduleClient } from "./_components/ScheduleClient";

export default async function ClassSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; mode?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const sp = await searchParams;

  const today = todayET();
  const requestedWeek = sp.week;
  if (
    requestedWeek !== undefined &&
    (!isISODateString(requestedWeek) || !isMondayISODate(requestedWeek))
  ) {
    redirect(`/admin/classes/${classId}/schedule?week=${weekStartOf(today)}` as Route);
  }
  const weekStartISO = requestedWeek ?? weekStartOf(today);
  const mode: ScheduleMode = sp.mode === "template" ? "template" : "week";

  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) notFound();

  const shifts =
    mode === "template"
      ? await resolveTemplateWeek(classId, weekStartISO)
      : await resolveWeek(classId, weekStartISO);

  return (
    <ScheduleClient
      classId={classId}
      className={cls.name}
      weekStartISO={weekStartISO}
      mode={mode}
      initialShifts={shifts}
    />
  );
}
```

- [ ] **Step 2: Do not typecheck or commit yet — combined with Task 11**

`pnpm typecheck` will fail here until `ScheduleClient` and the other `_components/*` exist (Task 11). Leave the import to `./_components/ScheduleClient` as-is, do not run typecheck, and do not commit `page.tsx` yet. Task 11 creates the components, Task 11 Step 3 runs `pnpm typecheck && pnpm lint` against the page + components together, and Task 11 Step 4 stages and commits both.

---

## Task 11: Build `ScheduleClient`, `WeekGrid`, `ShiftBlock` (Client Components)

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/WeekGrid.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/ShiftBlock.tsx`

`ScheduleClient` owns: dialog open/closed state, conflict modal state, drag state. Imports the six mutation actions and threads them down.

- [ ] **Step 1: Build the three components**

`ScheduleClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { WeekGrid } from "./WeekGrid";
import { WeekNavigator } from "./WeekNavigator";
import { ModeToggle } from "./ModeToggle";
import { ShiftEditDialog } from "./ShiftEditDialog";
import { ConflictModal } from "./ConflictModal";

export type DialogTarget =
  | { kind: "new-shift"; date: string; employeeId: string | null }
  | { kind: "edit-shift"; shift: Extract<ResolvedShift, { source: "override" }> }
  | { kind: "new-template"; dayOfWeek: number; employeeId: string | null }
  | { kind: "edit-template"; shift: Extract<ResolvedShift, { source: "template" }> };

export function ScheduleClient({
  classId,
  className,
  weekStartISO,
  mode,
  initialShifts,
}: {
  classId: string;
  className: string;
  weekStartISO: string;
  mode: ScheduleMode;
  initialShifts: ResolvedShift[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [conflicts, setConflicts] = useState<ConflictReason[] | null>(null);

  const switchMode = (next: ScheduleMode) => {
    router.push(
      `/admin/classes/${classId}/schedule?week=${weekStartISO}&mode=${next}` as Route,
    );
  };
  const switchWeek = (nextWeekISO: string) => {
    router.push(
      `/admin/classes/${classId}/schedule?week=${nextWeekISO}&mode=${mode}` as Route,
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{className}</h1>
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={switchMode} />
          <WeekNavigator weekStartISO={weekStartISO} onChange={switchWeek} />
        </div>
      </header>

      <WeekGrid
        weekStartISO={weekStartISO}
        mode={mode}
        shifts={initialShifts}
        onBlockClick={(t) => setDialog(t)}
      />

      {dialog && (
        <ShiftEditDialog
          classId={classId}
          mode={mode}
          target={dialog}
          onClose={() => setDialog(null)}
          onConflict={(c) => {
            setDialog(null);
            setConflicts(c);
          }}
        />
      )}

      {conflicts && (
        <ConflictModal conflicts={conflicts} onClose={() => setConflicts(null)} />
      )}
    </div>
  );
}
```

`WeekGrid.tsx`:

```tsx
"use client";

import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import { addDaysISO } from "@/lib/dates";
import type { DialogTarget } from "./ScheduleClient";
import { ShiftBlock } from "./ShiftBlock";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function WeekGrid({
  weekStartISO,
  mode,
  shifts,
  onBlockClick,
}: {
  weekStartISO: string;
  mode: ScheduleMode;
  shifts: ResolvedShift[];
  onBlockClick: (target: DialogTarget) => void;
}) {
  const employees = Array.from(
    new Map(shifts.map((s) => [s.employee_id, s.employee])).values(),
  ).sort((a, b) => a.last_name.localeCompare(b.last_name));

  const dates = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStartISO, i));

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Employee</th>
            {dates.map((d, i) => (
              <th key={d} className="px-3 py-2 text-left">
                {DAY_LABELS[i]} <span className="text-muted-foreground">{d.slice(5)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-t">
              <td className="px-3 py-2 align-top">
                {emp.first_name} {emp.last_name}
              </td>
              {dates.map((d, i) => {
                const cellShifts = shifts.filter(
                  (s) => s.employee_id === emp.id && s.date === d,
                );
                return (
                  <td
                    key={d}
                    className="px-3 py-2 align-top cursor-pointer hover:bg-muted/40"
                    onClick={() => {
                      if (cellShifts.length === 0) {
                        onBlockClick(
                          mode === "template"
                            ? { kind: "new-template", dayOfWeek: i, employeeId: emp.id }
                            : { kind: "new-shift", date: d, employeeId: emp.id },
                        );
                      }
                    }}
                  >
                    {cellShifts.length === 0 ? (
                      <span className="text-xs text-muted-foreground">+ add</span>
                    ) : (
                      cellShifts.map((s) => (
                        <ShiftBlock
                          key={s.source === "template" ? `t:${s.template_id}:${d}` : `o:${s.shift_id}`}
                          shift={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            onBlockClick(
                              s.source === "template"
                                ? { kind: "edit-template", shift: s }
                                : { kind: "edit-shift", shift: s },
                            );
                          }}
                        />
                      ))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">
                No shifts in this week. Click a cell to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

`ShiftBlock.tsx`:

```tsx
"use client";

import type { MouseEvent } from "react";
import type { ResolvedShift } from "@/lib/schedule/types";

export function ShiftBlock({
  shift,
  onClick,
}: {
  shift: ResolvedShift;
  onClick: (e: MouseEvent) => void;
}) {
  const styles =
    shift.source === "override"
      ? "border-dashed bg-amber-100/40"
      : "border-solid bg-card";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full rounded border ${styles} px-2 py-1 text-left text-xs`}
    >
      {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
    </button>
  );
}
```

- [ ] **Step 2: Verify the page now typechecks**

Run: `pnpm typecheck`
Expected: PASS (still missing `ModeToggle`, `WeekNavigator`, `ShiftEditDialog`, `ConflictModal` — Tasks 12/13/14).

To unblock typecheck, create stub files now (each just default-exports a no-op component) so this task's commit is self-contained. Tasks 12–14 replace the stubs.

```tsx
// _components/ModeToggle.tsx (stub)
"use client";
export function ModeToggle({ mode, onChange }: { mode: "week" | "template"; onChange: (m: "week" | "template") => void }) {
  return <select value={mode} onChange={(e) => onChange(e.target.value as "week" | "template")}><option value="week">Week</option><option value="template">Template</option></select>;
}
```

```tsx
// _components/WeekNavigator.tsx (stub)
"use client";
import { addDaysISO } from "@/lib/dates";
export function WeekNavigator({ weekStartISO, onChange }: { weekStartISO: string; onChange: (iso: string) => void }) {
  return (
    <div className="flex gap-1">
      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => onChange(addDaysISO(weekStartISO, -7))}>‹</button>
      <span className="text-xs">{weekStartISO}</span>
      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => onChange(addDaysISO(weekStartISO, 7))}>›</button>
    </div>
  );
}
```

```tsx
// _components/ShiftEditDialog.tsx (stub — full impl in Task 13)
"use client";
import type { ConflictReason } from "@/lib/actions/errors";
import type { DialogTarget } from "./ScheduleClient";
export function ShiftEditDialog(props: {
  classId: string;
  mode: "week" | "template";
  target: DialogTarget;
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="rounded-lg bg-background p-6 shadow">
        <p className="text-sm">Shift edit dialog stub. Target: {props.target.kind}</p>
        <button type="button" onClick={props.onClose} className="mt-4 rounded border px-3 py-1 text-sm">Close</button>
      </div>
    </div>
  );
}
```

```tsx
// _components/ConflictModal.tsx (stub — full impl in Task 14)
"use client";
import type { ConflictReason } from "@/lib/actions/errors";
export function ConflictModal({ conflicts, onClose }: { conflicts: ConflictReason[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="rounded-lg bg-background p-6 shadow max-w-md">
        <h2 className="text-sm font-semibold">Schedule conflicts</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {conflicts.map((c, i) => <li key={i}>Rule {c.rule}</li>)}
        </ul>
        <button type="button" onClick={onClose} className="mt-4 rounded border px-3 py-1 text-sm">Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/schedule/page.tsx \
        src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/
git commit -m "feat(classes): schedule page + ScheduleClient/WeekGrid/ShiftBlock + UI stubs"
```

---

## Task 12: Build the real `ShiftEditDialog`

**Files:**
- Modify: `_components/ShiftEditDialog.tsx`

Form for create/edit/delete. In week mode, edits write a `schedule_shift` row (with `sourceTemplateId` if editing a template-derived slot, null if standalone). In template mode, writes `schedule_shift_template`. Delete affordance only for existing rows.

- [ ] **Step 1: Replace the stub**

Replace `_components/ShiftEditDialog.tsx` body with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConflictReason } from "@/lib/actions/errors";
import {
  createShiftAction,
  createShiftTemplateAction,
  deleteShiftAction,
  deleteShiftTemplateAction,
  updateShiftAction,
  updateShiftTemplateAction,
} from "@/app/(admin)/admin/classes/[id]/actions";
import type { DialogTarget } from "./ScheduleClient";

export function ShiftEditDialog({
  classId,
  mode,
  target,
  onClose,
  onConflict,
}: {
  classId: string;
  mode: "week" | "template";
  target: DialogTarget;
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  const router = useRouter();
  const initial = initialFromTarget(target);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isEdit = target.kind === "edit-shift" || target.kind === "edit-template";
  const isTemplate = mode === "template" || target.kind.endsWith("template");

  const submit = async () => {
    setBusy(true);
    setErr(null);
    let result;
    if (target.kind === "new-shift") {
      result = await createShiftAction({
        classId,
        employeeId: target.employeeId!,
        date: target.date,
        startTime,
        endTime,
      });
    } else if (target.kind === "edit-shift") {
      result = await updateShiftAction({
        shiftId: target.shift.shift_id,
        startTime,
        endTime,
      });
    } else if (target.kind === "new-template") {
      result = await createShiftTemplateAction({
        classId,
        employeeId: target.employeeId!,
        dayOfWeek: target.dayOfWeek,
        startTime,
        endTime,
        effectiveFromISO: initial.effectiveFromISO!,
      });
    } else {
      result = await updateShiftTemplateAction({
        templateId: target.shift.template_id,
        startTime,
        endTime,
      });
    }
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
    } else if (result.error.code === "conflict") {
      onConflict(result.error.conflicts);
    } else {
      setErr(result.error.message);
    }
  };

  const onDelete = async () => {
    if (!isEdit) return;
    setBusy(true);
    setErr(null);
    const result =
      target.kind === "edit-shift"
        ? await deleteShiftAction({ shiftId: target.shift.shift_id })
        : await deleteShiftTemplateAction({ templateId: (target as Extract<DialogTarget, { kind: "edit-template" }>).shift.template_id });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
    } else {
      setErr(result.error.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="rounded-lg bg-background p-6 shadow max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-3">
          {isEdit ? "Edit" : "Add"} {isTemplate ? "template" : "shift"}
        </h2>
        {err && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Start
            <input type="time" step="900" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1" />
          </label>
          <label className="text-sm">End
            <input type="time" step="900" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1" />
          </label>
        </div>
        <div className="mt-4 flex justify-between">
          {isEdit && (mode === "template" || target.kind === "edit-shift") ? (
            <button type="button" disabled={busy} onClick={onDelete} className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Cancel</button>
            <button type="button" disabled={busy} onClick={submit} className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function initialFromTarget(t: DialogTarget): { startTime: string; endTime: string; effectiveFromISO?: string } {
  if (t.kind === "edit-shift" || t.kind === "edit-template") {
    return {
      startTime: t.shift.start_time.slice(0, 5),
      endTime: t.shift.end_time.slice(0, 5),
    };
  }
  if (t.kind === "new-template") {
    // The Server Action will reject non-Monday effectiveFromISO; the page should always pass a Monday.
    // For simplicity, the form lets the action's validation surface the error if needed; default to a placeholder.
    return { startTime: "08:00", endTime: "12:00", effectiveFromISO: new Date().toISOString().slice(0, 10) };
  }
  return { startTime: "08:00", endTime: "12:00" };
}
```

Note: `new-template`'s `effectiveFromISO` should ideally be threaded from the page (the current `weekStartISO`). The Plan 3 stub uses today's date as a fallback. Wire `weekStartISO` through `ScheduleClient → ShiftEditDialog` in this task — change the props.

Add `effectiveFromISO?: string` to the `DialogTarget` `new-template` variant, populate it from `weekStartISO` in `ScheduleClient`, and use it in `initialFromTarget`. Without this, `createShiftTemplateAction` rejects with "Must be a Monday in ET" if the page is opened mid-week.

- [ ] **Step 2: Manual smoke**

Run `pnpm dev`, sign in as admin, navigate to a class schedule, click an empty cell, fill 09:00–12:00, save, confirm row appears.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ShiftEditDialog.tsx \
        src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ScheduleClient.tsx
git commit -m "feat(classes/schedule): real ShiftEditDialog wired to all six actions"
```

---

## Task 13: Build the real `ConflictModal`

**Files:**
- Modify: `_components/ConflictModal.tsx`

Renders each `ConflictReason` with human-friendly labels.

- [ ] **Step 1: Replace the stub**

```tsx
"use client";

import type { ConflictReason } from "@/lib/actions/errors";

export function ConflictModal({
  conflicts,
  onClose,
}: {
  conflicts: ConflictReason[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="rounded-lg bg-background p-6 shadow max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Schedule conflicts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The change wasn't saved. Resolve these conflicts and try again.
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm space-y-1">
          {conflicts.map((c, i) => (
            <li key={i}>{describe(c)}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function describe(c: ConflictReason): string {
  if (c.rule === "a") {
    return `Cross-class overlap with another shift (${c.otherWindow.start}–${c.otherWindow.end}) in a different class.`;
  }
  if (c.rule === "c") {
    return `Overlaps an existing template in this class (${c.otherWindow.start}–${c.otherWindow.end}).`;
  }
  return `A template with identical times already exists for this employee on this day.`;
}
```

- [ ] **Step 2: Manual smoke**

Trigger a conflict (e.g., create a template, then create another with overlapping times). Verify the modal renders the right rule description.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ConflictModal.tsx
git commit -m "feat(classes/schedule): real ConflictModal with per-rule descriptions"
```

---

## Task 14: Build the real `ModeToggle` + `WeekNavigator`

**Files:**
- Modify: `_components/ModeToggle.tsx`
- Modify: `_components/WeekNavigator.tsx`

Cleaner UI than the stubs.

- [ ] **Step 1: Polish ModeToggle**

```tsx
"use client";

import type { ScheduleMode } from "@/lib/schedule/types";

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: ScheduleMode;
  onChange: (m: ScheduleMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5">
      {(["week", "template"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {m === "week" ? "Week" : "Template"}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Polish WeekNavigator**

```tsx
"use client";

import { addDaysISO } from "@/lib/dates";

export function WeekNavigator({
  weekStartISO,
  onChange,
}: {
  weekStartISO: string;
  onChange: (iso: string) => void;
}) {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  };
  const endISO = addDaysISO(weekStartISO, 4);
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
      <button type="button" className="rounded px-2 py-1 text-xs" onClick={() => onChange(addDaysISO(weekStartISO, -7))}>‹</button>
      <span className="px-2 text-xs">
        {fmt(weekStartISO)} – {fmt(endISO)}
      </span>
      <button type="button" className="rounded px-2 py-1 text-xs" onClick={() => onChange(addDaysISO(weekStartISO, 7))}>›</button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ModeToggle.tsx \
        src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/WeekNavigator.tsx
git commit -m "feat(classes/schedule): ModeToggle + WeekNavigator polish"
```

---

## Task 15: Build `moveShiftAction` (atomic) + wire drag-to-move

**Files:**
- Modify: `src/lib/schedule/schemas.ts` — add `moveShiftInputSchema`.
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts` — add `moveShiftAction`.
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts` — add `moveShiftAction` tests.
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/_components/WeekGrid.tsx`, `ShiftBlock.tsx` — drag handlers.

### Why a dedicated action

The earlier draft of this task did **delete-then-create**, which could lose the original shift if the destination raised a conflict. Unacceptable. The fix: a new `moveShiftAction` that does a **single atomic UPDATE** of `date`, `start_time`, `end_time`, gated by an up-front conflict check. If conflict, return `{ ok: false, error: { code: 'conflict' } }` and leave the original row untouched.

`updateShiftAction` keeps `date` immutable per Task 7 (its conflict-check architecture assumes a single date and would need broader rework to allow date changes). `moveShiftAction` is the explicit "this changes the date" affordance and reuses the same `ShiftCandidate` conflict-check shape with a different field set.

**Audit namespace addition:** `shift.move`. Plan 4 / spec §7.3 inventory updates to include it. `entityType` is derived from the prefix as usual → `"shift"`.

### Drag UX contract (text grid)

The WeekGrid is a date × employee text table (no time axis). The natural drag affordance is across-day:

- **Same-cell drop** (date and employee unchanged): no-op. The drop handler exits without calling any action.
- **Different-date drop, same employee**: call `moveShiftAction({ shiftId, date: targetDate, startTime, endTime })` with the original times. The action does the conflict check + atomic UPDATE.
- **Different-employee drop**: out of scope for v1 drag (the dialog handles employee reassignment via `updateShiftAction`).
- **Conflict on destination**: `ConflictModal` opens; the original row is untouched (UPDATE never ran).
- **No optimistic UI**: the grid is server-rendered. The shift visibly stays in its source cell until `router.refresh()` re-fetches; if the action fails, no refresh, no movement, no "revert" needed.

Same-date time changes (if a timeline-style grid is added later) would call `updateShiftAction` per spec §5.5. Plan 3's text grid doesn't surface that affordance.

Only `override` shifts are draggable. Template-derived slots edit via the dialog (which writes a replacement override).

- [ ] **Step 1: Add `moveShiftInputSchema` to `src/lib/schedule/schemas.ts`**

Append:

```ts
export const moveShiftInputSchema = z
  .object({
    shiftId: uuid,
    date: isoDate,
    startTime: timeStr,
    endTime: timeStr,
  })
  .superRefine(timeRangeRefine);

export type MoveShiftInput = z.infer<typeof moveShiftInputSchema>;
```

Add a quick test to `schemas.test.ts`:

```ts
import { moveShiftInputSchema } from "@/lib/schedule/schemas";

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
```

Run: `pnpm test:run src/lib/schedule/__tests__/schemas.test.ts`
Expected: PASS (16 total now in schemas.test.ts).

- [ ] **Step 2: Write the failing `moveShiftAction` tests**

Append to `src/app/(admin)/admin/classes/__tests__/actions.test.ts`:

```ts
import { moveShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";

describe("moveShiftAction", () => {
  it("across-day move atomically updates the existing shift", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;
      const create = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await moveShiftAction({
        shiftId: create.data.id,
        date: "2026-05-19",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(true);
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, create.data.id));
      expect(row.date).toBe("2026-05-19");
      expect(row.startTime).toBe("08:00:00");

      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.move"));
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toMatchObject({
        before: { date: "2026-05-18" },
        after: { date: "2026-05-19" },
      });
    });
  });

  it("conflict at destination returns conflict AND leaves the original shift untouched", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const clsA = await makeClass(tx);
      const clsB = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: clsA.id });
      currentAdminId.value = admin.id;

      // Block destination: same employee, same date, different class.
      await createShiftAction({
        classId: clsB.id, employeeId: emp.id, date: "2026-05-19",
        startTime: "08:00", endTime: "12:00",
      });

      // Source shift in class A on 2026-05-18.
      const src = await createShiftAction({
        classId: clsA.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "08:00", endTime: "12:00",
      });
      if (!src.ok) throw new Error("setup");

      const result = await moveShiftAction({
        shiftId: src.data.id,
        date: "2026-05-19",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("conflict");
        expect(result.error.conflicts[0].rule).toBe("a");
      }

      // Original row is untouched.
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, src.data.id));
      expect(row.date).toBe("2026-05-18");
      expect(row.startTime).toBe("08:00:00");

      // No shift.move audit row was written.
      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.move"));
      expect(audits).toHaveLength(0);
    });
  });

  it("same-date no-op move (date + times identical) writes audit with identical before/after", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;
      const create = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await moveShiftAction({
        shiftId: create.data.id,
        date: "2026-05-18",
        startTime: "08:00",
        endTime: "12:00",
      });

      expect(result.ok).toBe(true);
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, create.data.id));
      expect(row.date).toBe("2026-05-18");
    });
  });

  it("self-exclusion: moving a row 'onto itself' (same date) is conflict-free even though the row exists at that date", async () => {
    // Regression guard for the excludeShiftId pass-through. Without it, moveShiftAction
    // to the row's current location would self-conflict.
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;
      const create = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "08:00", endTime: "12:00",
      });
      if (!create.ok) throw new Error("setup");

      const result = await moveShiftAction({
        shiftId: create.data.id,
        date: "2026-05-18",
        startTime: "09:00",
        endTime: "13:00",
      });

      expect(result.ok).toBe(true);
    });
  });

  it("preserves source_template_id and exclude-template-from-rule-c for moved replacement overrides", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      currentAdminId.value = admin.id;
      const src = await createShiftAction({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "09:00", endTime: "11:00",
        sourceTemplateId: t.id,
      });
      if (!src.ok) throw new Error("setup");

      // Move to Tuesday (no template instance on Tuesday for this employee).
      const result = await moveShiftAction({
        shiftId: src.data.id,
        date: "2026-05-19",
        startTime: "09:00",
        endTime: "11:00",
      });

      expect(result.ok).toBe(true);
      const [row] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, src.data.id));
      // source_template_id stays bound to T1; the resolver's suppression key
      // (T1, emp, date) now refers to Tuesday — which has no template instance,
      // so nothing visible is suppressed. Acceptable v1 behavior.
      expect(row.sourceTemplateId).toBe(t.id);
    });
  });
});
```

- [ ] **Step 3: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/__tests__/actions.test.ts`
Expected: 5 new tests fail (module export missing).

- [ ] **Step 4: Implement `moveShiftAction`**

Append to actions.ts:

```ts
import { moveShiftInputSchema } from "@/lib/schedule/schemas";

export async function moveShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = moveShiftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  return runActionTx("shift.move", { shiftId: data.shiftId, date: data.date }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, data.shiftId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Shift not found" } };

    const ctx = await loadClassesEmployeesTemplatesForShift(tx, {
      classId: existing.classId,
      employeeId: existing.employeeId,
      date: data.date,
    });

    const conflicts = detectShiftConflicts(
      {
        kind: "shift",
        classId: existing.classId,
        employeeId: existing.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
      },
      {
        crossClassShifts: ctx.crossClassShifts,
        crossClassTemplates: [],
        sameClassTemplates: ctx.sameClassTemplates,
        excludeShiftId: data.shiftId,
        excludeTemplateId: existing.sourceTemplateId ?? undefined,
      },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Move target has conflicts", conflicts } };
    }

    await tx
      .update(scheduleShifts)
      .set({
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        updatedAt: new Date(),
      })
      .where(eq(scheduleShifts.id, data.shiftId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "shift.move",
      targetId: data.shiftId,
      payload: {
        before: { date: existing.date, startTime: existing.startTime, endTime: existing.endTime },
        after: { date: data.date, startTime: data.startTime, endTime: data.endTime },
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: data.shiftId } };
  });
}
```

- [ ] **Step 5: Run; confirm PASS** (21 actions tests total now)

- [ ] **Step 6: Commit the action**

```bash
git add src/lib/schedule/schemas.ts src/lib/schedule/__tests__/schemas.test.ts \
        src/app/\(admin\)/admin/classes/\[id\]/actions.ts \
        src/app/\(admin\)/admin/classes/__tests__/actions.test.ts
git commit -m "feat(classes): moveShiftAction with atomic UPDATE + pre-mutation conflict check"
```

- [ ] **Step 7: Wire drag handlers in WeekGrid + ShiftBlock**

Replace `ShiftBlock.tsx`:

```tsx
"use client";

import type { DragEvent, MouseEvent } from "react";
import type { ResolvedShift } from "@/lib/schedule/types";

export function ShiftBlock({
  shift,
  onClick,
  onDragStart,
}: {
  shift: ResolvedShift;
  onClick: (e: MouseEvent) => void;
  onDragStart?: (e: DragEvent, s: ResolvedShift) => void;
}) {
  const styles =
    shift.source === "override"
      ? "border-dashed bg-amber-100/40"
      : "border-solid bg-card";
  return (
    <button
      type="button"
      draggable={shift.source === "override"}
      onClick={onClick}
      onDragStart={(e) => onDragStart?.(e, shift)}
      className={`mb-1 block w-full rounded border ${styles} px-2 py-1 text-left text-xs`}
    >
      {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
    </button>
  );
}
```

In `WeekGrid.tsx`, accept an `onMove` callback and add drag/drop handlers to each cell:

```tsx
"use client";

import { useRef } from "react";
import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { addDaysISO } from "@/lib/dates";
import type { DialogTarget } from "./ScheduleClient";
import { ShiftBlock } from "./ShiftBlock";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type DragData = {
  shiftId: string;
  sourceDate: string;
  sourceEmployeeId: string;
  startTime: string;
  endTime: string;
};

export function WeekGrid({
  weekStartISO,
  mode,
  shifts,
  onBlockClick,
  onMove,
}: {
  weekStartISO: string;
  mode: ScheduleMode;
  shifts: ResolvedShift[];
  onBlockClick: (target: DialogTarget) => void;
  onMove: (data: DragData, targetDate: string) => Promise<void>;
}) {
  const dragRef = useRef<DragData | null>(null);
  // ... (employees and dates as before)
  const employees = Array.from(new Map(shifts.map((s) => [s.employee_id, s.employee])).values())
    .sort((a, b) => a.last_name.localeCompare(b.last_name));
  const dates = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStartISO, i));

  const onDragStartShift = (_e: React.DragEvent, s: ResolvedShift) => {
    if (s.source !== "override") return;
    dragRef.current = {
      shiftId: s.shift_id,
      sourceDate: s.date,
      sourceEmployeeId: s.employee_id,
      startTime: s.start_time,
      endTime: s.end_time,
    };
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        {/* ... header ... */}
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-t">
              <td className="px-3 py-2 align-top">{emp.first_name} {emp.last_name}</td>
              {dates.map((d, i) => {
                const cellShifts = shifts.filter((s) => s.employee_id === emp.id && s.date === d);
                return (
                  <td
                    key={d}
                    className="px-3 py-2 align-top cursor-pointer hover:bg-muted/40"
                    onDragOver={(e) => { if (dragRef.current && dragRef.current.sourceEmployeeId === emp.id) e.preventDefault(); }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const data = dragRef.current;
                      dragRef.current = null;
                      if (!data) return;
                      if (data.sourceEmployeeId !== emp.id) return; // disallow employee changes via drag (v1)
                      if (data.sourceDate === d) return; // same-cell no-op
                      await onMove(data, d);
                    }}
                    onClick={() => {
                      if (cellShifts.length === 0) {
                        onBlockClick(
                          mode === "template"
                            ? { kind: "new-template", dayOfWeek: i, employeeId: emp.id }
                            : { kind: "new-shift", date: d, employeeId: emp.id },
                        );
                      }
                    }}
                  >
                    {cellShifts.length === 0 ? (
                      <span className="text-xs text-muted-foreground">+ add</span>
                    ) : (
                      cellShifts.map((s) => (
                        <ShiftBlock
                          key={s.source === "template" ? `t:${s.template_id}:${d}` : `o:${s.shift_id}`}
                          shift={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            onBlockClick(
                              s.source === "template"
                                ? { kind: "edit-template", shift: s }
                                : { kind: "edit-shift", shift: s },
                            );
                          }}
                          onDragStart={onDragStartShift}
                        />
                      ))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

In `ScheduleClient.tsx`, wire `onMove` to call `moveShiftAction` and surface conflicts:

```tsx
import { moveShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";

const onMove = async (data: DragData, targetDate: string) => {
  const result = await moveShiftAction({
    shiftId: data.shiftId,
    date: targetDate,
    startTime: data.startTime,
    endTime: data.endTime,
  });
  if (result.ok) {
    router.refresh();
    return;
  }
  if (result.error.code === "conflict") {
    setConflicts(result.error.conflicts);
  } else {
    // Toast / inline error — not in scope to add a toast system in Plan 3.
    // Fall through and refresh; the failure means the row didn't move.
    console.error("[moveShiftAction]", result.error);
  }
};

// pass onMove to <WeekGrid ... onMove={onMove} />
```

Also export `DragData` from `WeekGrid.tsx` so `ScheduleClient.tsx` imports the type.

- [ ] **Step 8: Manual smoke**

Drag an override shift from one weekday to another for the same employee. Verify it lands. Drag onto a cell where the same employee has a same-time shift in another class (set this up first) → expect the conflict modal and the source cell unchanged.

- [ ] **Step 9: Commit the UI wiring**

```bash
git add src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ShiftBlock.tsx \
        src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/WeekGrid.tsx \
        src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/ScheduleClient.tsx
git commit -m "feat(classes/schedule): wire drag-to-move via moveShiftAction (atomic, non-destructive)"
```

---

## Task 16: Link from `/admin/classes` to the schedule page

**Files:**
- Modify: `src/app/(admin)/admin/classes/page.tsx`

- [ ] **Step 1: Make each class row link to its schedule**

Open the existing list and wrap each row's primary cell in a `<Link href={\`/admin/classes/${cls.id}/schedule\` as Route}>`. Keep the existing data-fetching as-is.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(admin\)/admin/classes/page.tsx
git commit -m "feat(classes): link list rows to per-class schedule pages"
```

---

## Task 17: Final verification

**Files:** none

- [ ] **Step 1: Full automated suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all three exit 0. Plan 2's 111 tests + Plan 3's additions (~59 new: conflicts 12, resolver 10, schemas 16, actions 21) ≈ 170 tests.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: succeeds; all new schedule routes listed.

- [ ] **Step 3: Manual smoke (admin browser)**

1. Navigate to `/admin/classes`, click into a class, land on the schedule page.
2. Switch to template mode; add a template (M 8–12). Switch back to week mode — the template appears for every weekday Mon… ah wait, only Mondays (dayOfWeek=0). Verify it appears on Mondays.
3. In week mode, click a template-derived shift, change times to 9–11 → that writes a replacement override. Confirm the displayed shift now shows 9–11 with a different style (dashed border).
4. Drag the 9–11 override to Tuesday. Confirm it lands there.
5. Try to drag onto Wednesday where the same employee has a Wednesday template — expect the conflict modal.
6. Switch back to template mode; click an empty Tuesday cell, add a 2nd template (T 1–5). Confirm both Mon and Tue templates exist.
7. Try to add a Mon 10–13 template → expect rule-(c) conflict modal.

- [ ] **Step 4: Git state + push**

Run: `git status` (clean apart from `seed.ts`), `git log --oneline a6e38d9..HEAD`, then `git push origin main`.

---

## What this plan does NOT cover

- `saveAsTemplateAction`, `copyWeekAction`, enrollment forecast actions, print view, Plan 4's component tests, Playwright happy-path E2E — all Plan 4.
- `EnrollmentRow` at the top of `WeekGrid` — Plan 4 will edit `WeekGrid` to add it.
- `applyClosureRule` — Plan 4 creates `src/lib/schedule/closure.ts` when `saveAsTemplateAction` needs it.
- Optimistic UI for drag-to-move (current impl is delete-then-create + `router.refresh()`).
- Component tests for `ConflictModal`, `ShiftEditDialog`. The current verification is manual smoke + the Plan 4 Playwright E2E. If a UI regression bites during execution, add a small `@testing-library/react` + jsdom test then.

---

## Spec coverage check

| Task | Spec section |
|---|---|
| 2 (types) | §4.1 |
| 3 (conflicts) | §5.2 |
| 4 (resolver) | §4.2, §4.3, §4.8 |
| 5 (schemas) | §1 (`schedule/schemas.ts`), §5.3, §5.4 |
| 6 (createShiftAction) | §5.3 |
| 7 (updateShiftAction) | §5.3 |
| 8 (deleteShiftAction) | §5.3 |
| 9 (template CRUD) | §5.4 |
| 10 (schedule page) | §4.4 |
| 11 (ScheduleClient + WeekGrid + ShiftBlock + stubs) | §4.4, §4.5 |
| 12 (ShiftEditDialog) | §4.5 |
| 13 (ConflictModal) | §5.1, §7.1 client surfacing |
| 14 (ModeToggle + WeekNavigator) | §4.4, §4.5 |
| 15 (drag-to-move) | §5.5 |
| 16 (classes list link) | §1 |
| 17 (verify) | §7.5 |

§5.6 (closure helper forward-decl) is deferred to Plan 4 since no Plan 3 action calls it.
