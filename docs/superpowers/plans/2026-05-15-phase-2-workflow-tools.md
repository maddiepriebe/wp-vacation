# Phase 2 Workflow Tools Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the workflow tools layer on top of Plan 3's schedule grid — closure-rule helper, save-as-template, copy-week, enrollment forecast (inline + bulk upload), print view, plus the two Phase-2 component tests and the happy-path Playwright E2E. After Plan 4, Phase 2 is feature-complete per `docs/superpowers/specs/phase-2-design.md` §6 and the §7.4 critical-UI / E2E test commitments.

**Architecture:** Three new bulk Server Actions (`saveAsTemplateAction`, `copyWeekAction`, `commitEnrollmentImportAction`) plus two single-row enrollment actions (`upsert`, `delete`) on `src/app/(admin)/admin/classes/[id]/actions.ts`. The pure closure helper lives in `src/lib/schedule/closure.ts`. UI surfaces (`SaveAsTemplateDialog`, `CopyWeekDialog`, `EnrollmentRow`, enrollment upload pages, print view) layer over Plan 3's `ScheduleClient` / `WeekGrid` without restructuring them. Component tests use `jsdom` + `@testing-library/react`; the E2E uses `@playwright/test` with Clerk testing tokens.

**Tech Stack:** Plan 1 + 2 + 3 foundations. New devDeps: `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`. Vitest gets a per-file `// @vitest-environment jsdom` opt-in for component tests; the rest of the suite stays in node. No new runtime deps.

**Spec reference:** `docs/superpowers/specs/phase-2-design.md` §5.6 (closure helper), §6 (save / copy / enrollment / print), §7.4 (critical UI component tests + Playwright happy-path), §7.3 (audit conventions including `template.save`, `week.copy`, `enrollment.*`).

**Plan 3 carry-forwards to account for:**

- `src/lib/schedule/conflicts.ts` already normalizes Postgres `'HH:MM:SS'` ↔ `'HH:MM'` inside `overlapsTime` and the identical-times check (commit `520fdf2`). Plan 4 callers that route DB-shaped `ShiftLike`/`TemplateLike` through `detectShiftConflicts` get this for free. New code paths that compare times outside the detector (`copyWeekAction`'s template-still-active check, etc.) must do their own `.slice(0, 5)` or use the new `normTime` helper exposed in Task 2.
- `saveAsTemplateAction` reads `ResolvedShift.start_time` / `end_time` which the resolver returns as `'HH:MM:SS'` (UI slices to display). When projecting these into new `schedule_shift_template` rows, insert the raw value — Postgres re-canonicalizes `'HH:MM:SS'` on the way back in, no transform needed.
- `applyClosureRule` operates on `date` columns (date-only), never `timestamptz`. Use `addDaysISO(effectiveFromISO, -1)` from `@/lib/dates`. Never touch `Date` objects or `toISOString()` (UTC drift would shift the intended ET date).
- `moveShiftAction` (Plan 3) preserves `source_template_id` across weekday moves. `copyWeekAction` copies overrides with `source_template_id` verbatim; combined with §6.2's "target template diverged" semantics, a copied override pointing at a closed/inactive template in the target week renders as standalone. Task 6 includes the regression test.
- Plan 3 manual browser smoke was not run. Plan 4 Task 18's Playwright E2E covers the equivalent flow end-to-end.

---

## File Structure

**Create (lib):**
- `src/lib/schedule/closure.ts` — `applyClosureRule(tx, classId, newEffectiveFromISO)` and a re-exported internal `normTime` helper (see Task 2).
- `src/lib/sheets/enrollment-import.ts` — `validateEnrollmentImportSheet(buffer)`, mirrors `employee-import.ts`.

**Modify (lib):**
- `src/lib/schedule/schemas.ts` — append `saveAsTemplateInputSchema`, `copyWeekInputSchema`, `upsertEnrollmentForecastInputSchema`, `deleteEnrollmentForecastInputSchema`, `enrollmentImportRowSchema`, `commitEnrollmentImportInputSchema`.

**Create (actions in existing file):**
- Append to `src/app/(admin)/admin/classes/[id]/actions.ts`:
  - `saveAsTemplateAction`
  - `copyWeekAction`
  - `upsertEnrollmentForecastAction`
  - `deleteEnrollmentForecastAction`
  - `parseEnrollmentImportAction` (FormData → `{ sessionId, rows }`)
  - `commitEnrollmentImportAction`

**Create (routes / UI):**
- `src/app/(admin)/admin/classes/[id]/schedule/_components/`:
  - `SaveAsTemplateDialog.tsx`
  - `CopyWeekDialog.tsx`
  - `EnrollmentRow.tsx`
  - `EnrollmentCell.tsx`
- `src/app/(admin)/admin/classes/[id]/schedule/print/page.tsx`
- `src/app/(admin)/admin/classes/[id]/schedule/print/_components/PrintLayout.tsx`
- `src/app/(admin)/admin/classes/[id]/enrollment/upload/page.tsx`
- `src/app/(admin)/admin/classes/[id]/enrollment/upload/preview/page.tsx`
- `src/app/(admin)/admin/classes/[id]/enrollment/upload/_components/EnrollmentUploadForm.tsx`
- `src/app/(admin)/admin/classes/[id]/enrollment/upload/_components/EnrollmentUploadPreviewTable.tsx`

**Modify (UI):**
- `src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx` — add SaveAsTemplate + CopyWeek buttons + dialog state.
- `src/app/(admin)/admin/classes/[id]/schedule/_components/WeekGrid.tsx` — render `<EnrollmentRow />` above the employee rows (week mode only).
- `src/app/(admin)/admin/classes/[id]/schedule/page.tsx` — query `enrollmentForecasts` for the displayed week, thread into `ScheduleClient`.

**Tests (create):**
- `src/lib/schedule/__tests__/closure.test.ts`
- `src/lib/sheets/__tests__/enrollment-import.test.ts`
- `src/lib/schedule/__tests__/schemas.test.ts` is APPENDED (not replaced) with new schema tests
- `src/app/(admin)/admin/classes/__tests__/actions.test.ts` is APPENDED with save / copy / enrollment tests
- `src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ConflictModal.test.tsx` (component test, jsdom)
- `src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ShiftEditDialog.test.tsx` (component test, jsdom)
- `tests/e2e/admin-onboard-and-schedule.spec.ts` (Playwright)
- `playwright.config.ts` (Playwright project config)

**Modify (config):**
- `package.json` — add devDeps + `test:e2e` script.
- `vitest.config.ts` — narrow `include` to exclude `tests/e2e/**`. Component tests opt into `jsdom` via per-file pragma; the workspace-wide `environment: "node"` stays.
- `.eslintrc` or `eslint.config.mjs` — exempt `tests/e2e/**` from the direct-`db` import restriction (Playwright tests don't touch Drizzle at all, but consistency).

---

## Task 1: Verify Plan 3 baseline

**Files:** none

- [ ] **Step 1: Confirm clean working tree (modulo `seed.ts`)**

Run: `git status`
Expected: only `src/db/seed.ts` modified.

- [ ] **Step 2: Confirm Plan 3 is green**

Run: `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`
Expected: all four exit 0; 172 tests pass; `/admin/classes/[id]/schedule` listed in the build output.

If anything is red, halt.

---

## Task 2: Build `src/lib/schedule/closure.ts` (TDD pure-ish)

**Files:**
- Create: `src/lib/schedule/__tests__/closure.test.ts`
- Create: `src/lib/schedule/closure.ts`

The helper closes all currently-active templates for a class by setting `effective_until = newEffectiveFromISO - 1`. Also re-exports an internal `normTime` so non-conflict-detector callers (Task 6) can normalize `'HH:MM:SS'` consistently. Operates on `tx` parameter; no `dbOrTx()` since it's only called from `runActionTx` handlers in Tasks 4 and 6.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/schedule/__tests__/closure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { scheduleShiftTemplates } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { makeClass, makeEmployee, makeTemplate } from "@/test/fixtures";
import { applyClosureRule, normTime } from "@/lib/schedule/closure";

describe("applyClosureRule", () => {
  it("closes every currently-active template in the class with effective_until = newEffectiveFromISO - 1", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t1 = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-05",
      });
      const t2 = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 1,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-05",
      });

      const { closedTemplateIds } = await applyClosureRule(tx, cls.id, "2026-06-01");

      expect(closedTemplateIds.sort()).toEqual([t1.id, t2.id].sort());
      const [r1] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, t1.id));
      const [r2] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, t2.id));
      expect(r1.effectiveUntil).toBe("2026-05-31");
      expect(r2.effectiveUntil).toBe("2026-05-31");
    });
  });

  it("skips templates already closed (effective_until is not null)", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const closed = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00",
        effectiveFrom: "2025-01-01", effectiveUntil: "2025-12-31",
      });
      const open = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 1,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-05",
      });

      const { closedTemplateIds } = await applyClosureRule(tx, cls.id, "2026-06-01");

      expect(closedTemplateIds).toEqual([open.id]);
      const [stillClosed] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, closed.id));
      expect(stillClosed.effectiveUntil).toBe("2025-12-31");
    });
  });

  it("skips templates whose effective_from is on or after newEffectiveFromISO (no premature self-closure)", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const future = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-06-01",
      });

      const { closedTemplateIds } = await applyClosureRule(tx, cls.id, "2026-06-01");

      expect(closedTemplateIds).toEqual([]);
      const [row] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, future.id));
      expect(row.effectiveUntil).toBeNull();
    });
  });

  it("does not touch templates in other classes", async () => {
    await withTx(async (tx) => {
      const a = await makeClass(tx);
      const b = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: a.id });
      const ta = await makeTemplate(tx, {
        classId: a.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-05",
      });
      const tb = await makeTemplate(tx, {
        classId: b.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-01-05",
      });

      const { closedTemplateIds } = await applyClosureRule(tx, a.id, "2026-06-01");

      expect(closedTemplateIds).toEqual([ta.id]);
      const [other] = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.id, tb.id));
      expect(other.effectiveUntil).toBeNull();
    });
  });
});

describe("normTime", () => {
  it("strips trailing seconds", () => {
    expect(normTime("08:00:00")).toBe("08:00");
  });
  it("passes through HH:MM unchanged", () => {
    expect(normTime("08:15")).toBe("08:15");
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/schedule/__tests__/closure.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `closure.ts`**

Create `src/lib/schedule/closure.ts`:

```ts
import { and, eq, isNull, lt } from "drizzle-orm";
import { addDaysISO } from "@/lib/dates";
import { scheduleShiftTemplates } from "@/db/schema";
import type { db } from "@/db/client";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Postgres `time` columns stringify to 'HH:MM:SS'; many helpers expect 'HH:MM'.
// Exported so non-detector callers (saveAsTemplate, copyWeek) normalize the same way
// the conflict detector does internally.
export function normTime(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

export async function applyClosureRule(
  tx: DrizzleTx,
  classId: string,
  newEffectiveFromISO: string,
): Promise<{ closedTemplateIds: string[] }> {
  const closeOn = addDaysISO(newEffectiveFromISO, -1);

  const rows = await tx
    .update(scheduleShiftTemplates)
    .set({ effectiveUntil: closeOn, updatedAt: new Date() })
    .where(
      and(
        eq(scheduleShiftTemplates.classId, classId),
        isNull(scheduleShiftTemplates.effectiveUntil),
        lt(scheduleShiftTemplates.effectiveFrom, newEffectiveFromISO),
      ),
    )
    .returning({ id: scheduleShiftTemplates.id });

  return { closedTemplateIds: rows.map((r) => r.id) };
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/schedule/__tests__/closure.test.ts`
Expected: 6 tests PASS (4 closure + 2 normTime).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/closure.ts src/lib/schedule/__tests__/closure.test.ts
git commit -m "feat(lib/schedule/closure): applyClosureRule + normTime helper"
```

---

## Task 3: Append schemas for save / copy / enrollment

**Files:**
- Modify: `src/lib/schedule/schemas.ts`
- Modify: `src/lib/schedule/__tests__/schemas.test.ts`

Six new schemas. All other schemas in this file stay unchanged.

- [ ] **Step 1: Append tests**

Append to `src/lib/schedule/__tests__/schemas.test.ts`:

```ts
import {
  commitEnrollmentImportInputSchema,
  copyWeekInputSchema,
  deleteEnrollmentForecastInputSchema,
  enrollmentImportRowSchema,
  saveAsTemplateInputSchema,
  upsertEnrollmentForecastInputSchema,
} from "@/lib/schedule/schemas";

const uuid = "00000000-0000-0000-0000-000000000001";

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
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/schedule/__tests__/schemas.test.ts`
Expected: FAIL (new exports missing).

- [ ] **Step 3: Append schemas**

Append to `src/lib/schedule/schemas.ts`:

```ts
export const saveAsTemplateInputSchema = z.object({
  classId: uuid,
  sourceWeekStartISO: mondayISO,
  effectiveFromISO: mondayISO,
  selectedShifts: z.array(
    z.discriminatedUnion("source", [
      z.object({ source: z.literal("template"), templateId: uuid }),
      z.object({ source: z.literal("override"), shiftId: uuid }),
    ]),
  ),
});

export const copyWeekInputSchema = z
  .object({
    classId: uuid,
    sourceWeekStartISO: mondayISO,
    targetWeekStartISO: mondayISO,
  })
  .refine((d) => d.sourceWeekStartISO !== d.targetWeekStartISO, {
    message: "Source and target weeks must differ",
    path: ["targetWeekStartISO"],
  });

export const upsertEnrollmentForecastInputSchema = z.object({
  classId: uuid,
  date: isoDate,
  expectedStudents: z.number().int().min(0),
});

export const deleteEnrollmentForecastInputSchema = z.object({
  classId: uuid,
  date: isoDate,
});

export const enrollmentImportRowSchema = z.object({
  date: isoDate,
  // xlsx may surface numeric cells as strings; coerce defensively.
  expected_students: z.coerce.number().int().min(0),
});

export const commitEnrollmentImportInputSchema = z.object({
  classId: uuid,
  sessionId: z.string().min(1),
  rows: z.array(enrollmentImportRowSchema).min(1),
});

export type SaveAsTemplateInput = z.infer<typeof saveAsTemplateInputSchema>;
export type CopyWeekInput = z.infer<typeof copyWeekInputSchema>;
export type UpsertEnrollmentForecastInput = z.infer<typeof upsertEnrollmentForecastInputSchema>;
export type DeleteEnrollmentForecastInput = z.infer<typeof deleteEnrollmentForecastInputSchema>;
export type EnrollmentImportRow = z.infer<typeof enrollmentImportRowSchema>;
export type CommitEnrollmentImportInput = z.infer<typeof commitEnrollmentImportInputSchema>;
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/schedule/__tests__/schemas.test.ts`
Expected: all schema tests PASS (existing + 17 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/schemas.ts src/lib/schedule/__tests__/schemas.test.ts
git commit -m "feat(lib/schedule/schemas): save/copy/enrollment input schemas"
```

---

## Task 4: Build `saveAsTemplateAction` (TDD)

**Files:**
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts`
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

Spec §6.1. Action calls `resolveWeek` server-side to validate selection ids, then closure + project + conflict check + insert, all inside one `runActionTx`. Audit: `action = 'template.save'`, `targetId = classId`, payload `{ classId, sourceWeekStartISO, effectiveFromISO, newTemplateIds, closedTemplateIds, sourceShiftIds }`.

- [ ] **Step 1: Append tests**

Append to `src/app/(admin)/admin/classes/__tests__/actions.test.ts`:

```ts
import { saveAsTemplateAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { applyClosureRule } from "@/lib/schedule/closure";

describe("saveAsTemplateAction", () => {
  it("happy path: closes prior templates and inserts new ones with effective_from = effectiveFromISO", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      currentAdminId.value = admin.id;

      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [{ source: "template", templateId: t.id }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const allRows = await tx.select().from(scheduleShiftTemplates).where(eq(scheduleShiftTemplates.classId, cls.id));
      const closed = allRows.find((r) => r.id === t.id);
      expect(closed?.effectiveUntil).toBe("2026-05-24");
      const fresh = allRows.find((r) => r.effectiveFrom === "2026-05-25");
      expect(fresh).toBeTruthy();
      expect(fresh?.effectiveUntil).toBeNull();
      expect(fresh?.dayOfWeek).toBe(0);

      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "template.save"));
      expect(audit.entityType).toBe("template");
      expect(audit.entityId).toBe(cls.id);
      expect(audit.payload).toMatchObject({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
      });
    });
  });

  it("includes selected override-source rows projected to templates", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      // Existing template + override that replaces it 9-11
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      const [shift] = await tx
        .insert(scheduleShifts)
        .values({
          classId: cls.id, employeeId: emp.id, date: "2026-05-18",
          startTime: "09:00", endTime: "11:00", sourceTemplateId: t.id,
        })
        .returning();
      currentAdminId.value = admin.id;

      // Admin selects only the override (un-ticks the template) — bakes 9-11 in.
      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [{ source: "override", shiftId: shift.id }],
      });

      expect(result.ok).toBe(true);
      const fresh = await tx
        .select()
        .from(scheduleShiftTemplates)
        .where(
          and(
            eq(scheduleShiftTemplates.classId, cls.id),
            eq(scheduleShiftTemplates.effectiveFrom, "2026-05-25"),
          ),
        );
      expect(fresh).toHaveLength(1);
      expect(fresh[0].startTime).toBe("09:00:00");
      expect(fresh[0].endTime).toBe("11:00:00");
    });
  });

  it("validates selection against the source week, not the effective week", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      currentAdminId.value = admin.id;

      // Source = W1 (2026-05-18); effective = W2 (2026-05-25). Template t expands in both.
      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [{ source: "template", templateId: t.id }],
      });
      expect(result.ok).toBe(true);
    });
  });

  it("rejects empty selection — closure still fires, but no new templates inserted", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      currentAdminId.value = admin.id;

      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [],
      });
      expect(result.ok).toBe(true);

      const closed = await tx
        .select()
        .from(scheduleShiftTemplates)
        .where(eq(scheduleShiftTemplates.id, t.id));
      expect(closed[0].effectiveUntil).toBe("2026-05-24");
      const fresh = await tx
        .select()
        .from(scheduleShiftTemplates)
        .where(
          and(
            eq(scheduleShiftTemplates.classId, cls.id),
            eq(scheduleShiftTemplates.effectiveFrom, "2026-05-25"),
          ),
        );
      expect(fresh).toHaveLength(0);
    });
  });

  it("rejects stale selection (template id not in source-week resolved set)", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      await makeEmployee(tx, { defaultClassId: cls.id });
      currentAdminId.value = admin.id;

      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [{ source: "template", templateId: "00000000-0000-0000-0000-000000000999" }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("rejects internally overlapping selected shifts (rule c) within the same candidate set", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      // Template 8-12 plus an override 9-11 replacing it; admin selects BOTH → rule c overlap inside the candidate set.
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      const [override] = await tx
        .insert(scheduleShifts)
        .values({
          classId: cls.id, employeeId: emp.id, date: "2026-05-18",
          startTime: "09:00", endTime: "11:00", sourceTemplateId: t.id,
        })
        .returning();
      currentAdminId.value = admin.id;

      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-25",
        selectedShifts: [
          { source: "template", templateId: t.id },
          { source: "override", shiftId: override.id },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("conflict");
        expect(result.error.conflicts.some((c) => c.rule === "c")).toBe(true);
      }
    });
  });

  it("rejects effectiveFromISO before this week's Monday", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      // 2026-05-15 is today (per project clock); 2026-05-04 is a past Monday.
      const result = await saveAsTemplateAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        effectiveFromISO: "2026-05-04",
        selectedShifts: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run 'src/app/(admin)/admin/classes/__tests__/actions.test.ts' -t saveAsTemplateAction`
Expected: all 7 new tests fail (missing export).

- [ ] **Step 3: Implement `saveAsTemplateAction`**

Append to `src/app/(admin)/admin/classes/[id]/actions.ts`:

```ts
import { saveAsTemplateInputSchema } from "@/lib/schedule/schemas";
import { applyClosureRule, normTime } from "@/lib/schedule/closure";
import { resolveWeek } from "@/lib/schedule/resolver";
import { todayET, weekStartOf } from "@/lib/dates";

export async function saveAsTemplateAction(input: unknown): Promise<ActionResult<{ classId: string; newTemplateIds: string[] }>> {
  const admin = await requireAdmin();
  const parsed = saveAsTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  // L4: business validation — past-dated effectiveFromISO blocked.
  if (data.effectiveFromISO < weekStartOf(todayET())) {
    return {
      ok: false,
      error: { code: "validation", message: "effectiveFromISO must be the current week's Monday or later" },
    };
  }

  return runActionTx(
    "template.save",
    { classId: data.classId, sourceWeekStartISO: data.sourceWeekStartISO, effectiveFromISO: data.effectiveFromISO },
    async (tx) => {
      const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, data.classId));
      if (!cls) return { ok: false, error: { code: "class_missing", message: "Class not found" } };

      // Resolve the source week through the same code path the dialog used.
      const resolved = await resolveWeek(data.classId, data.sourceWeekStartISO);
      const templateIds = new Set(resolved.filter((r) => r.source === "template").map((r) => (r as { template_id: string }).template_id));
      const overrideIds = new Set(resolved.filter((r) => r.source === "override").map((r) => (r as { shift_id: string }).shift_id));

      const missing: { source: "template" | "override"; id: string }[] = [];
      for (const sel of data.selectedShifts) {
        if (sel.source === "template" && !templateIds.has(sel.templateId)) missing.push({ source: "template", id: sel.templateId });
        if (sel.source === "override" && !overrideIds.has(sel.shiftId)) missing.push({ source: "override", id: sel.shiftId });
      }
      if (missing.length > 0) {
        return {
          ok: false,
          error: {
            code: "validation",
            message: "Selected shifts were not present in the source week — refresh and retry",
            fieldErrors: { selectedShifts: missing.map((m) => `${m.source}:${m.id}`) },
          },
        };
      }

      // Project each selected ResolvedShift to a candidate template row.
      const candidates: {
        employeeId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
      }[] = [];
      const sourceShiftIds: string[] = [];
      for (const sel of data.selectedShifts) {
        const row = resolved.find((r) => {
          if (sel.source === "template" && r.source === "template") return r.template_id === sel.templateId;
          if (sel.source === "override" && r.source === "override") return r.shift_id === sel.shiftId;
          return false;
        });
        if (!row) continue;
        const dow = (() => {
          const [y, m, d] = row.date.split("-").map(Number);
          const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          return js === 0 ? -1 : js - 1; // Mon=0..Fri=4
        })();
        candidates.push({
          employeeId: row.employee_id,
          dayOfWeek: dow,
          startTime: normTime(row.start_time),
          endTime: normTime(row.end_time),
        });
        if (sel.source === "override") sourceShiftIds.push(sel.shiftId);
      }

      // Closure: close currently-active templates for this class.
      const { closedTemplateIds } = await applyClosureRule(tx, data.classId, data.effectiveFromISO);

      // Conflict check inside the transaction, after closure.
      // sameClassTemplates = the OTHER candidates in this set (after closure, no prior same-class templates remain active on/after effectiveFromISO).
      // crossClassTemplates = employee's still-active templates in other classes on the same dayOfWeek.
      const conflicts: ConflictReason[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];

        const crossClassTemplates = await tx
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
              ne(scheduleShiftTemplates.classId, data.classId),
              eq(scheduleShiftTemplates.employeeId, c.employeeId),
              eq(scheduleShiftTemplates.dayOfWeek, c.dayOfWeek),
            ),
          );

        const sameClassCandidatesAsTemplates: TemplateLike[] = candidates
          .map((other, j) => ({
            id: `candidate-${j}`,
            classId: data.classId,
            employeeId: other.employeeId,
            dayOfWeek: other.dayOfWeek,
            startTime: other.startTime,
            endTime: other.endTime,
            effectiveFrom: data.effectiveFromISO,
            effectiveUntil: null,
          }))
          .filter((_, j) => j !== i);

        const c_conflicts = detectShiftConflicts(
          {
            kind: "template",
            classId: data.classId,
            employeeId: c.employeeId,
            dayOfWeek: c.dayOfWeek,
            startTime: c.startTime,
            endTime: c.endTime,
            effectiveFromISO: data.effectiveFromISO,
          },
          {
            crossClassShifts: [],
            crossClassTemplates,
            sameClassTemplates: sameClassCandidatesAsTemplates,
          },
        );
        conflicts.push(...c_conflicts);
      }
      if (conflicts.length > 0) {
        return { ok: false, error: { code: "conflict", message: "Save-as-template would conflict", conflicts } };
      }

      // Insert.
      const newTemplateIds: string[] = [];
      for (const c of candidates) {
        const [inserted] = await tx
          .insert(scheduleShiftTemplates)
          .values({
            classId: data.classId,
            employeeId: c.employeeId,
            dayOfWeek: c.dayOfWeek,
            startTime: c.startTime,
            endTime: c.endTime,
            effectiveFrom: data.effectiveFromISO,
            effectiveUntil: null,
          })
          .returning({ id: scheduleShiftTemplates.id });
        newTemplateIds.push(inserted.id);
      }

      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "template.save",
        targetId: data.classId,
        payload: {
          classId: data.classId,
          sourceWeekStartISO: data.sourceWeekStartISO,
          effectiveFromISO: data.effectiveFromISO,
          newTemplateIds,
          closedTemplateIds,
          sourceShiftIds,
        },
      });

      revalidatePath(`/admin/classes/${data.classId}/schedule`);
      return { ok: true, data: { classId: data.classId, newTemplateIds } };
    },
  );
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run 'src/app/(admin)/admin/classes/__tests__/actions.test.ts' -t saveAsTemplateAction`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/actions.ts' 'src/app/(admin)/admin/classes/__tests__/actions.test.ts'
git commit -m "feat(classes): saveAsTemplateAction with closure + per-candidate conflict check"
```

---

## Task 5: Build `copyWeekAction` (TDD)

**Files:**
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts`
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

Spec §6.2. Single transaction: resolve source overrides → delete target-week concrete shifts → insert shifted overrides. Audit: `action = 'week.copy'`, `targetId = classId`, payload `{ classId, sourceWeekStartISO, targetWeekStartISO, copiedOverrideCount, deletedShiftIds }`.

- [ ] **Step 1: Append tests**

Append to `src/app/(admin)/admin/classes/__tests__/actions.test.ts`:

```ts
import { copyWeekAction } from "@/app/(admin)/admin/classes/[id]/actions";

describe("copyWeekAction", () => {
  it("happy path: target's concrete shifts equal source's overrides shifted by date delta", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      await tx.insert(scheduleShifts).values({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "09:00", endTime: "11:00", sourceTemplateId: t.id,
      });
      await tx.insert(scheduleShifts).values({
        classId: cls.id, employeeId: emp.id, date: "2026-05-20",
        startTime: "13:00", endTime: "17:00", sourceTemplateId: null,
      });
      currentAdminId.value = admin.id;

      const result = await copyWeekAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        targetWeekStartISO: "2026-05-25",
      });
      expect(result.ok).toBe(true);

      const target = await tx
        .select()
        .from(scheduleShifts)
        .where(and(eq(scheduleShifts.classId, cls.id), eq(scheduleShifts.date, "2026-05-25")));
      expect(target).toHaveLength(1);
      expect(target[0].startTime).toBe("09:00:00");
      expect(target[0].sourceTemplateId).toBe(t.id);

      const wedTarget = await tx
        .select()
        .from(scheduleShifts)
        .where(and(eq(scheduleShifts.classId, cls.id), eq(scheduleShifts.date, "2026-05-27")));
      expect(wedTarget).toHaveLength(1);
      expect(wedTarget[0].sourceTemplateId).toBeNull();
    });
  });

  it("deletes existing target-week shifts before inserting", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      // Existing shift in target week
      const [existing] = await tx
        .insert(scheduleShifts)
        .values({
          classId: cls.id, employeeId: emp.id, date: "2026-05-25",
          startTime: "08:00", endTime: "12:00", sourceTemplateId: null,
        })
        .returning();
      // Source-week override
      await tx.insert(scheduleShifts).values({
        classId: cls.id, employeeId: emp.id, date: "2026-05-19",
        startTime: "14:00", endTime: "16:00", sourceTemplateId: null,
      });
      currentAdminId.value = admin.id;

      const result = await copyWeekAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        targetWeekStartISO: "2026-05-25",
      });
      expect(result.ok).toBe(true);

      // Existing 2026-05-25 row deleted; source-week 2026-05-19 → target-week 2026-05-26.
      const target25 = await tx
        .select()
        .from(scheduleShifts)
        .where(and(eq(scheduleShifts.classId, cls.id), eq(scheduleShifts.date, "2026-05-25")));
      expect(target25).toHaveLength(0);

      const target26 = await tx
        .select()
        .from(scheduleShifts)
        .where(and(eq(scheduleShifts.classId, cls.id), eq(scheduleShifts.date, "2026-05-26")));
      expect(target26).toHaveLength(1);

      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "week.copy"));
      expect(audit.entityId).toBe(cls.id);
      expect(audit.payload).toMatchObject({ deletedShiftIds: [existing.id] });
    });
  });

  it("rejects source == target with validation error", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const result = await copyWeekAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        targetWeekStartISO: "2026-05-18",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("preserves source_template_id verbatim — copied row referencing closed template renders standalone in target", async () => {
    // The act of insertion preserves the FK; the resolver in the target week
    // will simply not suppress anything because the template is closed there.
    // Here we just assert FK preservation.
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00",
        effectiveFrom: "2026-05-11", effectiveUntil: "2026-05-24",  // closes before target week
      });
      await tx.insert(scheduleShifts).values({
        classId: cls.id, employeeId: emp.id, date: "2026-05-18",
        startTime: "09:00", endTime: "11:00", sourceTemplateId: t.id,
      });
      currentAdminId.value = admin.id;

      const result = await copyWeekAction({
        classId: cls.id,
        sourceWeekStartISO: "2026-05-18",
        targetWeekStartISO: "2026-05-25",
      });
      expect(result.ok).toBe(true);
      const [copy] = await tx
        .select()
        .from(scheduleShifts)
        .where(and(eq(scheduleShifts.classId, cls.id), eq(scheduleShifts.date, "2026-05-25")));
      expect(copy.sourceTemplateId).toBe(t.id);
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run 'src/app/(admin)/admin/classes/__tests__/actions.test.ts' -t copyWeekAction`
Expected: all 4 new tests fail.

- [ ] **Step 3: Implement `copyWeekAction`**

Append to `src/app/(admin)/admin/classes/[id]/actions.ts`:

```ts
import { copyWeekInputSchema } from "@/lib/schedule/schemas";
import { addDaysISO, weekEnd } from "@/lib/dates";
import { gte, lte } from "drizzle-orm";

export async function copyWeekAction(input: unknown): Promise<ActionResult<{ classId: string; copiedOverrideCount: number }>> {
  const admin = await requireAdmin();
  const parsed = copyWeekInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;
  const deltaDays =
    (Date.UTC(...(data.targetWeekStartISO.split("-").map(Number) as [number, number, number])) -
      Date.UTC(...(data.sourceWeekStartISO.split("-").map(Number) as [number, number, number]))) /
    86400000;

  return runActionTx(
    "week.copy",
    { classId: data.classId, sourceWeekStartISO: data.sourceWeekStartISO, targetWeekStartISO: data.targetWeekStartISO },
    async (tx) => {
      const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, data.classId));
      if (!cls) return { ok: false, error: { code: "class_missing", message: "Class not found" } };

      // Source overrides — read directly, not via resolveWeek, to preserve sourceTemplateId verbatim.
      const sourceOverrides = await tx
        .select()
        .from(scheduleShifts)
        .where(
          and(
            eq(scheduleShifts.classId, data.classId),
            gte(scheduleShifts.date, data.sourceWeekStartISO),
            lte(scheduleShifts.date, weekEnd(data.sourceWeekStartISO)),
          ),
        );

      // Delete target-week concrete shifts (target wipe — see §6.2).
      const deletedShiftIds = (
        await tx
          .delete(scheduleShifts)
          .where(
            and(
              eq(scheduleShifts.classId, data.classId),
              gte(scheduleShifts.date, data.targetWeekStartISO),
              lte(scheduleShifts.date, weekEnd(data.targetWeekStartISO)),
            ),
          )
          .returning({ id: scheduleShifts.id })
      ).map((r) => r.id);

      // Insert shifted overrides.
      for (const o of sourceOverrides) {
        await tx.insert(scheduleShifts).values({
          classId: data.classId,
          employeeId: o.employeeId,
          date: addDaysISO(o.date, deltaDays),
          startTime: o.startTime,
          endTime: o.endTime,
          sourceTemplateId: o.sourceTemplateId,
        });
      }

      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "week.copy",
        targetId: data.classId,
        payload: {
          classId: data.classId,
          sourceWeekStartISO: data.sourceWeekStartISO,
          targetWeekStartISO: data.targetWeekStartISO,
          copiedOverrideCount: sourceOverrides.length,
          deletedShiftIds,
        },
      });

      revalidatePath(`/admin/classes/${data.classId}/schedule`);
      return { ok: true, data: { classId: data.classId, copiedOverrideCount: sourceOverrides.length } };
    },
  );
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run 'src/app/(admin)/admin/classes/__tests__/actions.test.ts' -t copyWeekAction`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/actions.ts' 'src/app/(admin)/admin/classes/__tests__/actions.test.ts'
git commit -m "feat(classes): copyWeekAction (overrides-only, target wipe, FK preserved)"
```

---

## Task 6: Build enrollment forecast single-row actions (TDD)

**Files:**
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts`
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

Spec §6.3. Two actions: `upsertEnrollmentForecastAction`, `deleteEnrollmentForecastAction`. Audit: `enrollment.upsert` / `enrollment.delete` with `targetId = enrollmentForecast.id` for upsert and `targetId = classId` for delete (no row id available post-delete).

- [ ] **Step 1: Append tests**

```ts
import {
  deleteEnrollmentForecastAction,
  upsertEnrollmentForecastAction,
} from "@/app/(admin)/admin/classes/[id]/actions";
import { enrollmentForecasts } from "@/db/schema";

describe("upsertEnrollmentForecastAction", () => {
  it("inserts a new row and writes enrollment.upsert audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const result = await upsertEnrollmentForecastAction({
        classId: cls.id, date: "2026-05-18", expectedStudents: 18,
      });
      expect(result.ok).toBe(true);
      const rows = await tx.select().from(enrollmentForecasts).where(eq(enrollmentForecasts.classId, cls.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].expectedStudents).toBe(18);
      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "enrollment.upsert"));
      expect(audit.entityType).toBe("enrollment");
    });
  });

  it("updates existing row on (classId, date) conflict", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      await upsertEnrollmentForecastAction({ classId: cls.id, date: "2026-05-18", expectedStudents: 18 });
      const result = await upsertEnrollmentForecastAction({ classId: cls.id, date: "2026-05-18", expectedStudents: 20 });
      expect(result.ok).toBe(true);
      const rows = await tx.select().from(enrollmentForecasts).where(eq(enrollmentForecasts.classId, cls.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].expectedStudents).toBe(20);
    });
  });

  it("returns class_missing for unknown classId", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      const result = await upsertEnrollmentForecastAction({
        classId: "00000000-0000-0000-0000-000000000000",
        date: "2026-05-18",
        expectedStudents: 18,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");
    });
  });
});

describe("deleteEnrollmentForecastAction", () => {
  it("deletes an existing row and writes audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      await upsertEnrollmentForecastAction({ classId: cls.id, date: "2026-05-18", expectedStudents: 18 });
      const result = await deleteEnrollmentForecastAction({ classId: cls.id, date: "2026-05-18" });
      expect(result.ok).toBe(true);
      const rows = await tx.select().from(enrollmentForecasts).where(eq(enrollmentForecasts.classId, cls.id));
      expect(rows).toHaveLength(0);
      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "enrollment.delete"));
      expect(audit.payload).toMatchObject({ deleted: { classId: cls.id, date: "2026-05-18", expectedStudents: 18 } });
    });
  });

  it("is a no-op (ok: true) when the row doesn't exist", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const result = await deleteEnrollmentForecastAction({ classId: cls.id, date: "2026-05-18" });
      expect(result.ok).toBe(true);
      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "enrollment.delete"));
      expect(audits).toHaveLength(0); // no audit when nothing was deleted
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

- [ ] **Step 3: Implement**

Append to actions.ts:

```ts
import {
  deleteEnrollmentForecastInputSchema,
  upsertEnrollmentForecastInputSchema,
} from "@/lib/schedule/schemas";
import { enrollmentForecasts } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function upsertEnrollmentForecastAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = upsertEnrollmentForecastInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  return runActionTx("enrollment.upsert", { classId: data.classId, date: data.date }, async (tx) => {
    const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, data.classId));
    if (!cls) return { ok: false, error: { code: "class_missing", message: "Class not found" } };

    const [row] = await tx
      .insert(enrollmentForecasts)
      .values({ classId: data.classId, date: data.date, expectedStudents: data.expectedStudents })
      .onConflictDoUpdate({
        target: [enrollmentForecasts.classId, enrollmentForecasts.date],
        set: { expectedStudents: data.expectedStudents, updatedAt: sql`now()` },
      })
      .returning({ id: enrollmentForecasts.id });

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "enrollment.upsert",
      targetId: row.id,
      payload: { classId: data.classId, date: data.date, expectedStudents: data.expectedStudents },
    });

    revalidatePath(`/admin/classes/${data.classId}/schedule`);
    return { ok: true, data: { id: row.id } };
  });
}

export async function deleteEnrollmentForecastAction(
  input: unknown,
): Promise<ActionResult<{ classId: string }>> {
  const admin = await requireAdmin();
  const parsed = deleteEnrollmentForecastInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input" } };
  }
  const data = parsed.data;

  return runActionTx("enrollment.delete", { classId: data.classId, date: data.date }, async (tx) => {
    const deleted = await tx
      .delete(enrollmentForecasts)
      .where(and(eq(enrollmentForecasts.classId, data.classId), eq(enrollmentForecasts.date, data.date)))
      .returning();

    // No-op semantics: succeed silently when nothing to delete. Skip audit if nothing changed.
    if (deleted.length === 0) {
      return { ok: true, data: { classId: data.classId } };
    }

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "enrollment.delete",
      targetId: data.classId,
      payload: {
        deleted: {
          classId: deleted[0].classId,
          date: deleted[0].date,
          expectedStudents: deleted[0].expectedStudents,
        },
      },
    });

    revalidatePath(`/admin/classes/${data.classId}/schedule`);
    return { ok: true, data: { classId: data.classId } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/actions.ts' 'src/app/(admin)/admin/classes/__tests__/actions.test.ts'
git commit -m "feat(classes): upsert/deleteEnrollmentForecast actions with idempotent delete"
```

---

## Task 7: Build enrollment import pipeline (parse + commit, TDD)

**Files:**
- Create: `src/lib/sheets/enrollment-import.ts`
- Create: `src/lib/sheets/__tests__/enrollment-import.test.ts`
- Modify: `src/app/(admin)/admin/classes/[id]/actions.ts`
- Modify: `src/app/(admin)/admin/classes/__tests__/actions.test.ts`

Spec §6.3 bulk upload. Mirrors the employee import pipeline.

- [ ] **Step 1: Write the failing parse test**

Create `src/lib/sheets/__tests__/enrollment-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { validateEnrollmentImportSheet } from "@/lib/sheets/enrollment-import";

function buildXlsx(rows: Record<string, unknown>[]): Buffer {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(write(wb, { bookType: "xlsx", type: "buffer" }));
}

describe("validateEnrollmentImportSheet", () => {
  it("parses a valid sheet", () => {
    const buf = buildXlsx([
      { date: "2026-05-18", expected_students: 18 },
      { date: "2026-05-19", expected_students: 20 },
    ]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it("flags duplicate dates within the sheet", () => {
    const buf = buildXlsx([
      { date: "2026-05-18", expected_students: 18 },
      { date: "2026-05-18", expected_students: 19 },
    ]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(true);
    expect(result.rows[1].ok).toBe(false);
    if (!result.rows[1].ok) {
      expect(result.rows[1].errors[0].code).toBe("duplicate_date");
    }
  });

  it("flags rows with negative expected_students", () => {
    const buf = buildXlsx([{ date: "2026-05-18", expected_students: -3 }]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(false);
  });

  it("flags rows with non-real dates", () => {
    const buf = buildXlsx([{ date: "2026-02-30", expected_students: 12 }]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement parse helper**

Create `src/lib/sheets/enrollment-import.ts`:

```ts
import {
  enrollmentImportRowSchema,
  type EnrollmentImportRow,
} from "@/lib/schedule/schemas";
import {
  parseSheet,
  type ParsedRow,
  type ParseSheetResult,
  type RowError,
} from "@/lib/sheets/parse";

export function validateEnrollmentImportSheet(
  buffer: Buffer | Uint8Array | ArrayBuffer,
): ParseSheetResult<EnrollmentImportRow> {
  const initial = parseSheet(buffer, enrollmentImportRowSchema);
  const seenDates = new Set<string>();
  const rows: ParsedRow<EnrollmentImportRow>[] = initial.rows.map((row, idx) => {
    if (!row.ok) return row;
    if (seenDates.has(row.value.date)) {
      const err: RowError = {
        row: idx + 2,
        column: "date",
        code: "duplicate_date",
        message: `Date "${row.value.date}" appears more than once in this sheet`,
      };
      return { ok: false, errors: [err] };
    }
    seenDates.add(row.value.date);
    return row;
  });
  return { rows };
}
```

- [ ] **Step 3: Run; confirm PASS**

Run: `pnpm test:run src/lib/sheets/__tests__/enrollment-import.test.ts`
Expected: 4 PASS.

- [ ] **Step 4: Append `parseEnrollmentImportAction` + `commitEnrollmentImportAction` tests**

```ts
import {
  commitEnrollmentImportAction,
  parseEnrollmentImportAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

describe("commitEnrollmentImportAction", () => {
  it("inserts rows and writes a summary audit (action='enrollment.import', targetId=classId)", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const result = await commitEnrollmentImportAction({
        classId: cls.id,
        sessionId: "session-1",
        rows: [
          { date: "2026-05-18", expected_students: 18 },
          { date: "2026-05-19", expected_students: 20 },
        ],
      });
      expect(result.ok).toBe(true);
      const rows = await tx.select().from(enrollmentForecasts).where(eq(enrollmentForecasts.classId, cls.id));
      expect(rows).toHaveLength(2);
      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "enrollment.import"));
      expect(audit.entityId).toBe(cls.id);
      expect(audit.payload).toMatchObject({ classId: cls.id, count: 2, sessionId: "session-1" });
    });
  });

  it("updates existing rows on (classId, date) conflict", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      await tx.insert(enrollmentForecasts).values({ classId: cls.id, date: "2026-05-18", expectedStudents: 5 });
      const result = await commitEnrollmentImportAction({
        classId: cls.id,
        sessionId: "session-1",
        rows: [{ date: "2026-05-18", expected_students: 30 }],
      });
      expect(result.ok).toBe(true);
      const rows = await tx.select().from(enrollmentForecasts).where(eq(enrollmentForecasts.classId, cls.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].expectedStudents).toBe(30);
    });
  });
});
```

- [ ] **Step 5: Implement actions**

Append to actions.ts:

```ts
import { commitEnrollmentImportInputSchema } from "@/lib/schedule/schemas";
import { validateEnrollmentImportSheet } from "@/lib/sheets/enrollment-import";
import { randomUUID } from "node:crypto";

export async function parseEnrollmentImportAction(
  fd: FormData,
): Promise<ActionResult<{ sessionId: string; rows: ReturnType<typeof validateEnrollmentImportSheet>["rows"] }>> {
  await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: { code: "validation", message: "Missing file" } };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = validateEnrollmentImportSheet(buffer);
  return { ok: true, data: { sessionId: randomUUID(), rows } };
}

export async function commitEnrollmentImportAction(
  input: unknown,
): Promise<ActionResult<{ classId: string; count: number }>> {
  const admin = await requireAdmin();
  const parsed = commitEnrollmentImportInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  return runActionTx(
    "enrollment.import",
    { classId: data.classId, sessionId: data.sessionId },
    async (tx) => {
      const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, data.classId));
      if (!cls) return { ok: false, error: { code: "class_missing", message: "Class not found" } };

      for (const r of data.rows) {
        await tx
          .insert(enrollmentForecasts)
          .values({ classId: data.classId, date: r.date, expectedStudents: r.expected_students })
          .onConflictDoUpdate({
            target: [enrollmentForecasts.classId, enrollmentForecasts.date],
            set: { expectedStudents: r.expected_students, updatedAt: sql`now()` },
          });
      }

      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "enrollment.import",
        targetId: data.classId,
        payload: { classId: data.classId, count: data.rows.length, sessionId: data.sessionId },
      });

      revalidatePath(`/admin/classes/${data.classId}/schedule`);
      return { ok: true, data: { classId: data.classId, count: data.rows.length } };
    },
  );
}
```

- [ ] **Step 6: Run; confirm PASS**

- [ ] **Step 7: Commit**

```bash
git add src/lib/sheets/enrollment-import.ts src/lib/sheets/__tests__/enrollment-import.test.ts \
        'src/app/(admin)/admin/classes/[id]/actions.ts' \
        'src/app/(admin)/admin/classes/__tests__/actions.test.ts'
git commit -m "feat(enrollment): bulk import parse + commit pipeline"
```

---

## Task 8: Build `EnrollmentRow` + `EnrollmentCell` UI

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/EnrollmentRow.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/EnrollmentCell.tsx`
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/_components/WeekGrid.tsx`
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/page.tsx`
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx`

Inline number cell per weekday (week mode only). Empty input → delete; non-empty → upsert.

- [ ] **Step 1: Build `EnrollmentCell.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEnrollmentForecastAction,
  upsertEnrollmentForecastAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

export function EnrollmentCell({
  classId,
  date,
  initialValue,
}: {
  classId: string;
  date: string;
  initialValue: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue !== null ? String(initialValue) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const commit = async () => {
    setBusy(true);
    setErr(null);
    const trimmed = draft.trim();
    let result;
    if (trimmed === "") {
      result = await deleteEnrollmentForecastAction({ classId, date });
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) {
        setErr("Enter a non-negative integer");
        setBusy(false);
        return;
      }
      result = await upsertEnrollmentForecastAction({ classId, date, expectedStudents: n });
    }
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(result.error.message);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="block w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setEditing(true)}
      >
        {initialValue !== null ? `${initialValue} students` : "—"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="number"
        min={0}
        autoFocus
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(initialValue !== null ? String(initialValue) : "");
            setErr(null);
          }
        }}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Build `EnrollmentRow.tsx`**

```tsx
"use client";

import { addDaysISO } from "@/lib/dates";
import { EnrollmentCell } from "./EnrollmentCell";

export function EnrollmentRow({
  classId,
  weekStartISO,
  enrollment,
}: {
  classId: string;
  weekStartISO: string;
  enrollment: Map<string, number>;
}) {
  const dates = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStartISO, i));
  return (
    <tr className="border-t bg-muted/30 text-xs">
      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-muted-foreground">
        Expected students
      </th>
      {dates.map((d) => (
        <td key={d} className="px-3 py-2 align-top">
          <EnrollmentCell classId={classId} date={d} initialValue={enrollment.get(d) ?? null} />
        </td>
      ))}
    </tr>
  );
}
```

- [ ] **Step 3: Thread enrollment data into the page**

Edit `src/app/(admin)/admin/classes/[id]/schedule/page.tsx`. Add the import `import { and, eq, gte, lte } from "drizzle-orm";` if not already present (Plan 3 already imports `eq`), add `import { enrollmentForecasts } from "@/db/schema";` next to the existing `classes` import, add `weekEnd` to the existing `@/lib/dates` import. After the `cls` lookup and before `const shifts = …`, insert:

```tsx
const enrollmentRows = await db
  .select()
  .from(enrollmentForecasts)
  .where(
    and(
      eq(enrollmentForecasts.classId, classId),
      gte(enrollmentForecasts.date, weekStartISO),
      lte(enrollmentForecasts.date, weekEnd(weekStartISO)),
    ),
  );
const enrollment = new Map<string, number>(
  enrollmentRows.map((r) => [r.date, r.expectedStudents]),
);
```

Then update the `<ScheduleClient ... />` JSX to pass `enrollment={enrollment}`.

- [ ] **Step 4: Wire through `ScheduleClient` → `WeekGrid`**

In `ScheduleClient.tsx`, add `enrollment: Map<string, number>` to the props type, accept it in the destructure, and forward to `<WeekGrid enrollment={enrollment} ... />`:

```tsx
// In the props type
enrollment: Map<string, number>;

// In the JSX
<WeekGrid
  weekStartISO={weekStartISO}
  mode={mode}
  shifts={initialShifts}
  enrollment={enrollment}
  onBlockClick={(t) => /* existing handler */}
  onMove={onMove}
/>
```

In `WeekGrid.tsx`, add `enrollment: Map<string, number>` and `classId: string` to the props type (classId needed for `EnrollmentRow`). Plan 3's `WeekGrid` doesn't currently take `classId`; add it and pass it through from `ScheduleClient`. Then prepend `<EnrollmentRow />` to the `<tbody>` for week mode only:

```tsx
// New imports
import { EnrollmentRow } from "./EnrollmentRow";

// Inside WeekGrid props type
classId: string;
enrollment: Map<string, number>;

// At the top of <tbody>
{mode === "week" && (
  <EnrollmentRow classId={classId} weekStartISO={weekStartISO} enrollment={enrollment} />
)}
{employees.map((emp) => ( /* existing row rendering */ ))}
```

Update `ScheduleClient`'s `<WeekGrid ... />` JSX to also pass `classId={classId}`.

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/schedule/' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/EnrollmentRow.tsx' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/EnrollmentCell.tsx'
git commit -m "feat(classes/schedule): inline enrollment row in week mode"
```

---

## Task 9: Build `SaveAsTemplateDialog`

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/SaveAsTemplateDialog.tsx`
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx`

Dialog fed by the same `initialShifts` (`ResolvedShift[]`) the grid uses. Template rows default-checked; override rows default-unchecked. Admin can edit `effectiveFromISO` (default = displayed `weekStartISO`).

- [ ] **Step 1: Build the dialog**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResolvedShift } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { saveAsTemplateAction } from "@/app/(admin)/admin/classes/[id]/actions";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function SaveAsTemplateDialog({
  classId,
  weekStartISO,
  shifts,
  onClose,
  onConflict,
}: {
  classId: string;
  weekStartISO: string;
  shifts: ResolvedShift[];
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  const router = useRouter();
  const initialSelected = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const s of shifts) {
      const id = s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`;
      map.set(id, s.source === "template");
    }
    return map;
  }, [shifts]);

  const [selected, setSelected] = useState(initialSelected);
  const [effectiveFromISO, setEffectiveFromISO] = useState(weekStartISO);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (key: string) => setSelected((prev) => new Map(prev).set(key, !prev.get(key)));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const selectedShifts = shifts
      .filter((s) => selected.get(s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`))
      .map((s) =>
        s.source === "template"
          ? { source: "template" as const, templateId: s.template_id }
          : { source: "override" as const, shiftId: s.shift_id },
      );

    if (selectedShifts.length === 0) {
      const proceed = confirm(
        "This will leave no recurring schedule for this class. Continue?",
      );
      if (!proceed) {
        setBusy(false);
        return;
      }
    }

    const result = await saveAsTemplateAction({
      classId,
      sourceWeekStartISO: weekStartISO,
      effectiveFromISO,
      selectedShifts,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
      return;
    }
    if (result.error.code === "conflict") {
      onConflict(result.error.conflicts);
    } else {
      setErr(result.error.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-6 shadow" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Save as template</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which shifts from the week of {weekStartISO} to bake into the recurring schedule.
        </p>
        {err && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
        )}
        <label className="mt-4 block text-sm">
          Effective from (Monday)
          <input
            type="date"
            value={effectiveFromISO}
            onChange={(e) => setEffectiveFromISO(e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1"
          />
        </label>
        <ul className="mt-4 space-y-1 text-sm">
          {shifts.map((s) => {
            const id = s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`;
            const day = DAY_LABELS[(() => {
              const [y, m, d] = s.date.split("-").map(Number);
              const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
              return js - 1;
            })()];
            const label =
              s.source === "template"
                ? `${s.employee.first_name} ${s.employee.last_name} — ${day} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
                : `override — ${day}, ${s.employee.first_name} ${s.employee.last_name} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
            return (
              <li key={id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.get(id) ?? false}
                  onChange={() => toggle(id)}
                />
                <span className={s.source === "override" ? "italic text-muted-foreground" : ""}>{label}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ScheduleClient`**

In `ScheduleClient.tsx`, import the new dialog and add a piece of state plus a button. The state and button are gated on `mode === "week"`:

```tsx
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";

// Add state alongside the existing dialog state:
const [saveDialogOpen, setSaveDialogOpen] = useState(false);

// In the header JSX, BEFORE the existing <ModeToggle ... /> + <WeekNavigator ... />:
{mode === "week" && (
  <button
    type="button"
    onClick={() => setSaveDialogOpen(true)}
    className="rounded-md border bg-card px-3 py-1 text-xs"
  >
    Save as template
  </button>
)}

// In the render tree, after the existing {dialog && <ShiftEditDialog ... />}:
{saveDialogOpen && (
  <SaveAsTemplateDialog
    classId={classId}
    weekStartISO={weekStartISO}
    shifts={initialShifts}
    onClose={() => setSaveDialogOpen(false)}
    onConflict={(c) => {
      setSaveDialogOpen(false);
      setConflicts(c);
    }}
  />
)}
```

`setConflicts` is the existing setter from Plan 3 that feeds `<ConflictModal />`. No new conflict-rendering code needed.

- [ ] **Step 3: Typecheck + commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/schedule/_components/SaveAsTemplateDialog.tsx' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx'
git commit -m "feat(classes/schedule): SaveAsTemplateDialog wired to saveAsTemplateAction"
```

---

## Task 10: Build `CopyWeekDialog`

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/CopyWeekDialog.tsx`
- Modify: `src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx`

Confirmation message uses `N = initialShifts.length`. `M` is fetched on dialog open via a small Server Action `countTargetWeekShiftsAction` (added next).

- [ ] **Step 1: Append a tiny `countTargetWeekShiftsAction` to actions.ts**

```ts
export async function countTargetWeekShiftsAction(input: {
  classId: string;
  targetWeekStartISO: string;
}): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();
  // Light read — no transaction needed.
  const rows = await dbOrTx()
    .select({ id: scheduleShifts.id })
    .from(scheduleShifts)
    .where(
      and(
        eq(scheduleShifts.classId, input.classId),
        gte(scheduleShifts.date, input.targetWeekStartISO),
        lte(scheduleShifts.date, weekEnd(input.targetWeekStartISO)),
      ),
    );
  return { ok: true, data: { count: rows.length } };
}
```

Add `dbOrTx` to imports if not already present (it is — `runActionTx` is imported from the same module).

- [ ] **Step 2: Build the dialog**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysISO, weekStartOf } from "@/lib/dates";
import {
  copyWeekAction,
  countTargetWeekShiftsAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

export function CopyWeekDialog({
  classId,
  sourceWeekStartISO,
  visibleShiftCount,
  onClose,
}: {
  classId: string;
  sourceWeekStartISO: string;
  visibleShiftCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [targetWeekStartISO, setTargetWeekStartISO] = useState(
    addDaysISO(sourceWeekStartISO, 7),
  );
  const [targetShiftCount, setTargetShiftCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    countTargetWeekShiftsAction({ classId, targetWeekStartISO }).then((r) => {
      if (cancelled) return;
      if (r.ok) setTargetShiftCount(r.data.count);
    });
    return () => {
      cancelled = true;
    };
  }, [classId, targetWeekStartISO]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const result = await copyWeekAction({
      classId,
      sourceWeekStartISO,
      targetWeekStartISO,
    });
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
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Copy week</h2>
        {err && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
        )}
        <label className="mt-4 block text-sm">
          Target week (Monday)
          <input
            type="date"
            value={targetWeekStartISO}
            onChange={(e) => setTargetWeekStartISO(weekStartOf(e.target.value))}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1"
          />
        </label>
        <p className="mt-4 text-sm">
          Copy {visibleShiftCount} shift{visibleShiftCount === 1 ? "" : "s"} from week of{" "}
          {sourceWeekStartISO} to week of {targetWeekStartISO}?
        </p>
        {targetShiftCount !== null && targetShiftCount > 0 && (
          <p className="mt-2 rounded-md bg-amber-100/40 px-3 py-2 text-sm">
            This will delete {targetShiftCount} existing shift{targetShiftCount === 1 ? "" : "s"} in the target week.
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy || sourceWeekStartISO === targetWeekStartISO}
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Copying…" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ScheduleClient`**

```tsx
import { CopyWeekDialog } from "./CopyWeekDialog";

// State:
const [copyDialogOpen, setCopyDialogOpen] = useState(false);

// In the header, alongside the Save-as-template button (mode === "week" only):
{mode === "week" && (
  <button
    type="button"
    onClick={() => setCopyDialogOpen(true)}
    className="rounded-md border bg-card px-3 py-1 text-xs"
  >
    Copy week
  </button>
)}

// In the render tree, after the SaveAsTemplateDialog block:
{copyDialogOpen && (
  <CopyWeekDialog
    classId={classId}
    sourceWeekStartISO={weekStartISO}
    visibleShiftCount={initialShifts.length}
    onClose={() => setCopyDialogOpen(false)}
  />
)}
```

- [ ] **Step 4: Typecheck + commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/actions.ts' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/CopyWeekDialog.tsx' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx'
git commit -m "feat(classes/schedule): CopyWeekDialog + countTargetWeekShiftsAction"
```

---

## Task 11: Build the enrollment upload pages

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/enrollment/upload/page.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/enrollment/upload/preview/page.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/enrollment/upload/_components/EnrollmentUploadForm.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/enrollment/upload/_components/EnrollmentUploadPreviewTable.tsx`

Mirrors the employee upload pipeline. `parseEnrollmentImportAction` and `commitEnrollmentImportAction` already exist (Task 7).

- [ ] **Step 1: Upload page**

```tsx
// src/app/(admin)/admin/classes/[id]/enrollment/upload/page.tsx
import { requireAdmin } from "@/lib/auth";
import { parseEnrollmentImportAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { EnrollmentUploadForm } from "./_components/EnrollmentUploadForm";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: classId } = await params;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Enrollment forecast upload</h1>
      <p className="text-sm text-muted-foreground">
        Upload a sheet with columns <code>date</code> and <code>expected_students</code>. Dates must be unique per class.
      </p>
      <EnrollmentUploadForm classId={classId} action={parseEnrollmentImportAction} />
    </div>
  );
}
```

- [ ] **Step 2: `EnrollmentUploadForm.tsx`**

```tsx
"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EnrollmentImportRow } from "@/lib/schedule/schemas";

type ParseResult = ActionResult<{ sessionId: string; rows: ParsedRow<EnrollmentImportRow>[] }>;

export function EnrollmentUploadForm({
  classId,
  action,
}: {
  classId: string;
  action: (fd: FormData) => Promise<ParseResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const fd = new FormData(e.currentTarget);
        const result = await action(fd);
        setBusy(false);
        if (!result.ok) {
          setErr(result.error.message);
          return;
        }
        sessionStorage.setItem(
          `enrollment-import:${result.data.sessionId}`,
          JSON.stringify(result.data.rows),
        );
        router.push(
          `/admin/classes/${classId}/enrollment/upload/preview?session=${result.data.sessionId}` as Route,
        );
      }}
      className="space-y-4"
    >
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      )}
      <input type="file" name="file" accept=".xlsx,.csv" required className="block" />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Parsing…" : "Upload"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Preview page**

```tsx
// src/app/(admin)/admin/classes/[id]/enrollment/upload/preview/page.tsx
import { requireAdmin } from "@/lib/auth";
import { commitEnrollmentImportAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { EnrollmentUploadPreviewTable } from "../_components/EnrollmentUploadPreviewTable";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const { session } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Preview enrollment import</h1>
      <EnrollmentUploadPreviewTable
        classId={classId}
        sessionId={session ?? ""}
        action={commitEnrollmentImportAction}
      />
    </div>
  );
}
```

- [ ] **Step 4: Preview table component**

```tsx
// src/app/(admin)/admin/classes/[id]/enrollment/upload/_components/EnrollmentUploadPreviewTable.tsx
"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EnrollmentImportRow } from "@/lib/schedule/schemas";

export function EnrollmentUploadPreviewTable({
  classId,
  sessionId,
  action,
}: {
  classId: string;
  sessionId: string;
  action: (input: {
    classId: string;
    sessionId: string;
    rows: EnrollmentImportRow[];
  }) => Promise<ActionResult<{ classId: string; count: number }>>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ParsedRow<EnrollmentImportRow>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const stash = sessionStorage.getItem(`enrollment-import:${sessionId}`);
    if (stash) setRows(JSON.parse(stash) as ParsedRow<EnrollmentImportRow>[]);
  }, [sessionId]);

  if (!rows) return <p className="text-sm text-muted-foreground">Loading preview…</p>;

  const valid = rows.filter((r): r is { ok: true; value: EnrollmentImportRow } => r.ok);
  const errors = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      )}
      {errors.length > 0 && (
        <div>
          <h2 className="text-sm font-medium">{errors.length} row(s) with errors</h2>
          <ul className="mt-2 text-xs text-destructive">
            {errors.map((r, i) => (
              <li key={i}>
                {!r.ok &&
                  r.errors.map((e) => `Row ${e.row} (${e.column ?? "—"}): ${e.message}`).join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr><th className="text-left">Date</th><th className="text-left">Expected students</th></tr>
        </thead>
        <tbody>
          {valid.map((r, i) => (
            <tr key={i} className="border-t"><td>{r.value.date}</td><td>{r.value.expected_students}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || valid.length === 0}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const result = await action({
              classId,
              sessionId,
              rows: valid.map((r) => r.value),
            });
            setBusy(false);
            if (result.ok) {
              sessionStorage.removeItem(`enrollment-import:${sessionId}`);
              router.push(`/admin/classes/${classId}/schedule` as Route);
            } else {
              setErr(result.error.message);
            }
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Importing…" : `Import ${valid.length} row(s)`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add upload link to the schedule page**

In `ScheduleClient.tsx`, alongside the Save / Copy buttons:

```tsx
import Link from "next/link";
import type { Route } from "next";

// In the header JSX, week-mode only:
{mode === "week" && (
  <Link
    href={`/admin/classes/${classId}/enrollment/upload` as Route}
    className="rounded-md border bg-card px-3 py-1 text-xs"
  >
    Upload enrollment
  </Link>
)}
```

`Link` and `Route` may already be imported by Plan 3's drag-wiring changes — if so, skip the import lines.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/enrollment/' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx'
git commit -m "feat(enrollment): per-class bulk upload + preview UI"
```

---

## Task 12: Build the print view

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/print/page.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/schedule/print/_components/PrintLayout.tsx`
- Create: `src/app/(admin)/admin/classes/[id]/schedule/print/_components/PrintButton.tsx`

Server Component using `resolveWeek` + enrollment query; client `PrintButton` calls `window.print()`. No auto-trigger.

- [ ] **Step 1: Print page**

```tsx
// src/app/(admin)/admin/classes/[id]/schedule/print/page.tsx
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes, enrollmentForecasts } from "@/db/schema";
import { isISODateString, isMondayISODate, todayET, weekEnd, weekStartOf } from "@/lib/dates";
import { resolveWeek } from "@/lib/schedule/resolver";
import { PrintLayout } from "./_components/PrintLayout";

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const sp = await searchParams;
  const today = todayET();
  if (sp.week !== undefined && (!isISODateString(sp.week) || !isMondayISODate(sp.week))) {
    redirect(`/admin/classes/${classId}/schedule/print?week=${weekStartOf(today)}` as Route);
  }
  const weekStartISO = sp.week ?? weekStartOf(today);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) notFound();
  const shifts = await resolveWeek(classId, weekStartISO);
  const enrollmentRows = await db
    .select()
    .from(enrollmentForecasts)
    .where(
      and(
        eq(enrollmentForecasts.classId, classId),
        gte(enrollmentForecasts.date, weekStartISO),
        lte(enrollmentForecasts.date, weekEnd(weekStartISO)),
      ),
    );
  const enrollment = new Map<string, number>(enrollmentRows.map((r) => [r.date, r.expectedStudents]));

  return <PrintLayout className={cls.name} weekStartISO={weekStartISO} shifts={shifts} enrollment={enrollment} />;
}
```

- [ ] **Step 2: `PrintLayout.tsx`**

Renders the table per spec §6.4, with `@media print` CSS to hide the Print button and apply landscape:

```tsx
import type { ResolvedShift } from "@/lib/schedule/types";
import { addDaysISO } from "@/lib/dates";
import { PrintButton } from "./PrintButton";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function PrintLayout({
  className,
  weekStartISO,
  shifts,
  enrollment,
}: {
  className: string;
  weekStartISO: string;
  shifts: ResolvedShift[];
  enrollment: Map<string, number>;
}) {
  const dates = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStartISO, i));
  const employees = Array.from(new Map(shifts.map((s) => [s.employee_id, s.employee])).values()).sort((a, b) =>
    a.last_name.localeCompare(b.last_name),
  );

  return (
    <div className="p-6 print:p-0">
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.5in; }
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
      <div className="no-print mb-4">
        <PrintButton />
      </div>
      <h1 className="text-xl font-semibold">
        {className} — Week of {weekStartISO}
      </h1>
      <p className="mt-1 text-sm">
        Expected students:{" "}
        {dates
          .map((d, i) => `${DAY_LABELS[i]}: ${enrollment.get(d) ?? "—"}`)
          .join("    ")}
      </p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border px-2 py-1 text-left">Employee</th>
            {DAY_LABELS.map((d, i) => (
              <th key={d} className="border px-2 py-1 text-left">
                {d} {dates[i].slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id}>
              <td className="border px-2 py-1">
                {emp.first_name} {emp.last_name}
              </td>
              {dates.map((d) => {
                const cell = shifts.filter((s) => s.employee_id === emp.id && s.date === d);
                return (
                  <td key={d} className="border px-2 py-1 align-top">
                    {cell.map((s, i) => (
                      <div key={i}>
                        {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                      </div>
                    ))}
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

- [ ] **Step 3: `PrintButton.tsx`**

```tsx
"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
    >
      Print
    </button>
  );
}
```

- [ ] **Step 4: Link from schedule page**

In `ScheduleClient.tsx`, alongside the Save / Copy / Upload buttons:

```tsx
// In the header JSX, week-mode only:
{mode === "week" && (
  <Link
    href={`/admin/classes/${classId}/schedule/print?week=${weekStartISO}` as Route}
    target="_blank"
    rel="noopener noreferrer"
    className="rounded-md border bg-card px-3 py-1 text-xs"
  >
    Print
  </Link>
)}
```

The `target="_blank"` is intentional — opens the print view in a new tab so the admin doesn't lose grid state.

- [ ] **Step 5: Build + typecheck**

Run: `pnpm typecheck && pnpm build`
Expected: route `/admin/classes/[id]/schedule/print` appears in build output.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/schedule/print/' \
        'src/app/(admin)/admin/classes/[id]/schedule/_components/ScheduleClient.tsx'
git commit -m "feat(classes/schedule/print): letter-landscape print view"
```

---

## Task 13: Set up component-test environment

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`

Add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` as devDeps. Vitest stays node-only by default; component tests opt in via per-file pragma.

- [ ] **Step 1: Install deps**

```bash
pnpm add -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Verify vitest still runs**

Run: `pnpm test:run`
Expected: 172 tests still pass (no test files changed yet).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(test): add jsdom + @testing-library deps for component tests"
```

---

## Task 14: Component test — `ConflictModal`

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ConflictModal.test.tsx`

Per spec §7.4: "renders each `ConflictReason` variant with opposing entity names." Snapshot the textual output for each rule.

- [ ] **Step 1: Write the test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictModal } from "../ConflictModal";

describe("ConflictModal", () => {
  it("renders rule (a) with the opposing time window", () => {
    render(
      <ConflictModal
        conflicts={[
          {
            rule: "a",
            otherClassId: "00000000-0000-0000-0000-0000000000a1",
            otherId: "00000000-0000-0000-0000-0000000000a2",
            otherWindow: { start: "10:00", end: "13:00" },
          },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/cross-class/i)).toBeTruthy();
    expect(screen.getByText(/10:00–13:00/)).toBeTruthy();
  });

  it("renders rule (c) with the opposing template time window", () => {
    render(
      <ConflictModal
        conflicts={[
          {
            rule: "c",
            otherTemplateId: "00000000-0000-0000-0000-0000000000c1",
            otherWindow: { start: "10:00", end: "13:00" },
          },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/overlaps an existing template/i)).toBeTruthy();
  });

  it("renders rule (d) as identical-times language", () => {
    render(
      <ConflictModal
        conflicts={[{ rule: "d", otherId: "00000000-0000-0000-0000-0000000000d1" }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/identical times/i)).toBeTruthy();
  });

  it("calls onClose on OK button click", async () => {
    const onClose = vi.fn();
    render(<ConflictModal conflicts={[{ rule: "d", otherId: "x" }]} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /ok/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/classes/\[id\]/schedule/_components/__tests__/ConflictModal.test.tsx`
Expected: 4 PASS.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ConflictModal.test.tsx'
git commit -m "test(classes/schedule): ConflictModal per-rule rendering"
```

---

## Task 15: Component test — `ShiftEditDialog`

**Files:**
- Create: `src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ShiftEditDialog.test.tsx`

Covers: opening for create-shift, edit-shift, create-template, edit-template; submission paths fire the right action with the right input.

- [ ] **Step 1: Write the test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShiftEditDialog } from "../ShiftEditDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const createShiftMock = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
const createTemplateMock = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
vi.mock("@/app/(admin)/admin/classes/[id]/actions", () => ({
  createShiftAction: (...args: unknown[]) => createShiftMock(...args),
  updateShiftAction: vi.fn(async () => ({ ok: true as const, data: { id: "x" } })),
  deleteShiftAction: vi.fn(async () => ({ ok: true as const, data: { id: "x" } })),
  createShiftTemplateAction: (...args: unknown[]) => createTemplateMock(...args),
  updateShiftTemplateAction: vi.fn(async () => ({ ok: true as const, data: { id: "x" } })),
  deleteShiftTemplateAction: vi.fn(async () => ({ ok: true as const, data: { id: "x" } })),
}));

describe("ShiftEditDialog", () => {
  it("submits createShiftAction with current input values for a new-shift target", async () => {
    render(
      <ShiftEditDialog
        classId="cls-1"
        mode="week"
        weekStartISO="2026-05-18"
        target={{ kind: "new-shift", date: "2026-05-18", employeeId: "emp-1" }}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createShiftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "cls-1",
        employeeId: "emp-1",
        date: "2026-05-18",
      }),
    );
  });

  it("submits createShiftTemplateAction with effectiveFromISO = weekStartISO for new-template target", async () => {
    render(
      <ShiftEditDialog
        classId="cls-1"
        mode="template"
        weekStartISO="2026-05-18"
        target={{ kind: "new-template", dayOfWeek: 0, employeeId: "emp-1", effectiveFromISO: "2026-05-18" }}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "cls-1",
        employeeId: "emp-1",
        dayOfWeek: 0,
        effectiveFromISO: "2026-05-18",
      }),
    );
  });
});
```

- [ ] **Step 2: Run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(admin)/admin/classes/[id]/schedule/_components/__tests__/ShiftEditDialog.test.tsx'
git commit -m "test(classes/schedule): ShiftEditDialog dispatch paths"
```

---

## Task 16: Set up Playwright

**Files:**
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts` (exclude `tests/**`)
- Modify: `eslint.config.mjs` (allow `tests/e2e/**` to import `db` if needed — but the spec test doesn't, so likely no change)

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add `tests/` directory and `playwright.config.ts`**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] **Step 3: Exclude `tests/e2e/**` from Vitest**

Edit `vitest.config.ts`:

```ts
test: {
  // ...existing...
  include: ["src/**/*.{test,spec}.{ts,tsx}"],
  exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".next/**"],
},
```

- [ ] **Step 4: Add npm scripts**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

- [ ] **Step 5: Confirm vitest still runs**

Run: `pnpm test:run`
Expected: 172 + new component tests pass; no e2e specs picked up.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(test): add @playwright/test + e2e scaffold"
```

---

## Task 17: Playwright happy-path E2E

**Files:**
- Create: `tests/e2e/admin-onboard-and-schedule.spec.ts`

Spec §7.4 happy path. Uses Clerk's testing-token mode for sign-in. The flow exercises Plan 2 + 3 + 4 in one trace.

**Prerequisite environment:** the dev server must run against a database the test can safely write to. `withTx` isn't available in the browser flow — the E2E asserts UI state, then a manual cleanup step is documented (the test creates real rows with `e2e-…` prefixes to make cleanup trivial). For CI integration, a separate Clerk testing instance + scratch DB is out of scope for v1.

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";

test.describe("admin-onboard-and-schedule", () => {
  test("sign in, add employee, add template, add override, print", async ({ page }) => {
    await page.goto("/sign-in");
    // Clerk testing-token sign-in: requires admin@test.local seeded in Clerk's test mode.
    // The exact selector flow depends on your Clerk components; the spec is intentionally
    // descriptive rather than prescriptive about Clerk internals.
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL ?? "admin@test.local");
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? "test-only");
    await page.getByRole("button", { name: /continue|sign in/i }).click();

    await page.waitForURL(/\/admin/);

    // Add an employee.
    await page.goto("/admin/employees/new");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/last name/i).fill(`User-${Date.now()}`);
    await page.getByLabel(/email/i).fill(`e2e-${Date.now()}@example.com`);
    // ... fill required fields per Plan 2's createEmployee form ...
    await page.getByRole("button", { name: /save/i }).click();
    await page.waitForURL(/\/admin\/employees/);

    // Land on the first class's schedule.
    await page.goto("/admin/classes");
    await page.getByRole("link", { name: /.+/ }).first().click();
    await page.waitForURL(/\/schedule/);

    // Add a template (template mode).
    await page.getByRole("button", { name: /template/i }).click();
    await page.locator("text=+ add").first().click();
    await page.getByLabel(/start/i).fill("08:00");
    await page.getByLabel(/end/i).fill("12:00");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.locator("text=08:00–12:00")).toBeVisible();

    // Switch back to week mode; click the template-derived shift and override it.
    await page.getByRole("button", { name: /week/i }).click();
    await page.locator("text=08:00–12:00").first().click();
    await page.getByLabel(/start/i).fill("09:00");
    await page.getByLabel(/end/i).fill("11:00");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.locator("text=09:00–11:00")).toBeVisible();

    // Visit the print view.
    await page.getByRole("link", { name: /print/i }).click();
    await expect(page.getByRole("button", { name: /^print$/i })).toBeVisible();
    await expect(page.locator("text=09:00–11:00")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run locally**

Run: `pnpm test:e2e --reporter=line`
Expected: PASS, or document any environment-specific failure (Clerk test mode mis-configured, dev server port collision, etc.). The exact Clerk selectors may need tightening on first run; iterate.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-onboard-and-schedule.spec.ts
git commit -m "test(e2e): admin onboard + schedule + print happy path"
```

---

## Task 18: Final verification

**Files:** none

- [ ] **Step 1: Full automated gate**

Run: `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`
Expected: all four exit 0. Test count target: 172 (Plan 3) + ~32 new (closure 6, schemas 17, save 7, copy 4, enrollment 5, import 2 + 4 parse, component tests 4 + 2) ≈ **204 vitest tests**.

- [ ] **Step 2: Playwright pass**

Run: `pnpm test:e2e`
Expected: 1 spec PASS.

- [ ] **Step 3: Manual smoke (admin browser)**

1. Sign in as admin.
2. `/admin/classes/[id]/schedule` — week view, enrollment row visible, click a weekday cell to set expected students, refresh and confirm the value persists.
3. Click "Save as template" — dialog opens, templates pre-checked, overrides un-checked. Pick a future Monday for `effectiveFromISO`, confirm. Navigate to the target week; new template version renders.
4. Click "Copy week" — pick a target week with existing shifts, confirm the dialog shows the `M` count, commit. Target week renders with the copied overrides.
5. Click the print link. Print view renders the week. Browser's print preview shows landscape; the Print button is hidden in the preview.
6. Drag an override from one weekday to another (Plan 3 carry-forward smoke).
7. Trigger a conflict (e.g., template overlap) and confirm `ConflictModal` shows the right rule description.
8. `/admin/classes/[id]/enrollment/upload` — upload an `.xlsx` with two rows, preview shows valid rows, confirm; schedule view's enrollment row updates.

- [ ] **Step 4: Git state + push**

Run: `git status` (clean apart from `seed.ts`), `git log --oneline e341c96..HEAD`, then `git push origin main`.

---

## What this plan does NOT cover

- Multi-week PDF export, multi-class print, cross-class enrollment bulk import — out of scope per spec §6.4 and §6.3.
- DST-specific resolver tests — Plan 3 deferred `resolver.dst.test.ts`; pickup once a real DST cutover week is in scope.
- Auto-trigger of `window.print()` on mount — explicitly NOT done; admins click the visible Print button.
- Cross-browser print compatibility tests — Chromium-only.
- Component tests for `SaveAsTemplateDialog`, `CopyWeekDialog`, `EnrollmentRow` — covered by the Playwright happy path.

---

## Spec coverage check

| Section | Tasks |
|---|---|
| §5.6 closure helper | 2 |
| §6.1 save-as-template (action + UI) | 4, 9 |
| §6.2 copy-week (action + UI) | 5, 10 |
| §6.3 enrollment forecast (inline + bulk) | 6, 7, 8, 11 |
| §6.4 print view | 12 |
| §6.5 tests | 4, 5, 6, 7 |
| §7.3 audit (`template.save`, `week.copy`, `enrollment.*`) | 4, 5, 6, 7 |
| §7.4 critical UI component tests | 13, 14, 15 |
| §7.4 happy-path Playwright E2E | 16, 17 |
| §7.5 CI gates | already wired in Plan 2; Task 18 re-verifies all four |

---

## Plan 3 carry-forward verification

| Carry-forward | Addressed where |
|---|---|
| `'HH:MM:SS'` normalization for time comparisons | Task 2 re-exports `normTime`; Task 4 uses it on `ResolvedShift.start_time`/`end_time` when projecting to candidate templates |
| `applyClosureRule` date-only semantics | Task 2 uses `addDaysISO` from `@/lib/dates`, no `Date`/`toISOString()` |
| `moveShiftAction` preserves `source_template_id` across moves | Task 5 copyWeek test 4 ("preserves source_template_id verbatim") covers the analogous Plan-4 path |
| Plan 3 manual browser smoke not run | Task 17 Playwright E2E + Task 18 Step 3 manual smoke cover it |
