import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, scheduleShifts, scheduleShiftTemplates } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { makeAdmin, makeClass, makeEmployee, makeTemplate } from "@/test/fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const currentAdminId = { value: "" };
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: currentAdminId.value }),
}));

import {
  createShiftAction,
  createShiftTemplateAction,
  deleteShiftAction,
  deleteShiftTemplateAction,
  moveShiftAction,
  updateShiftAction,
  updateShiftTemplateAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

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
        if (result.error.code === "conflict") {
          expect(result.error.conflicts[0].rule).toBe("a");
        }
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
        if (result.error.code === "conflict") {
          expect(result.error.conflicts[0].rule).toBe("c");
        }
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
        if (result.error.code === "conflict") {
          expect(result.error.conflicts[0].rule).toBe("c");
        }
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
      if (!result.ok) {
        if (result.error.code === "conflict") {
          expect(result.error.conflicts[0].rule).toBe("a");
        }
      }
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
        if (result.error.code === "conflict") {
          expect(result.error.conflicts[0].rule).toBe("a");
        }
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

import { saveAsTemplateAction } from "@/app/(admin)/admin/classes/[id]/actions";

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
      // Template 8-12 plus a standalone override 9-11 on the same Monday.
      // Both surface in the resolver (no sourceTemplateId → no suppression).
      // Admin selects BOTH → rule c overlap inside the candidate set.
      const t = await makeTemplate(tx, {
        classId: cls.id, employeeId: emp.id, dayOfWeek: 0,
        startTime: "08:00", endTime: "12:00", effectiveFrom: "2026-05-11",
      });
      const [override] = await tx
        .insert(scheduleShifts)
        .values({
          classId: cls.id, employeeId: emp.id, date: "2026-05-18",
          startTime: "09:00", endTime: "11:00", sourceTemplateId: null,
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
      if (!result.ok && result.error.code === "conflict") {
        expect(result.error.conflicts.some((c) => c.rule === "c")).toBe(true);
      } else {
        expect.fail(`expected conflict error, got ${result.ok ? "ok" : result.error.code}`);
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
