import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
