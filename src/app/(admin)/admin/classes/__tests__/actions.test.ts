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
