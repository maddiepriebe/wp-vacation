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
