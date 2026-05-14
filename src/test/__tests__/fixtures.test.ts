import { describe, expect, it } from "vitest";
import { withTx } from "@/test/with-tx";
import {
  makeClass,
  makeEmployee,
  makeShift,
  makeTemplate,
} from "@/test/fixtures";

describe("fixtures", () => {
  it("makeClass produces unique names across calls", async () => {
    await withTx(async (tx) => {
      const a = await makeClass(tx);
      const b = await makeClass(tx);
      expect(a.id).not.toBe(b.id);
      expect(a.name).not.toBe(b.name);
    });
  });

  it("makeEmployee produces unique emails across calls", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const e1 = await makeEmployee(tx, { defaultClassId: cls.id });
      const e2 = await makeEmployee(tx, { defaultClassId: cls.id });
      expect(e1.email).not.toBe(e2.email);
      expect(e1.email).toMatch(/^test-.+@example\.com$/);
    });
  });

  it("overrides take precedence over defaults", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx, { name: "MyClass" });
      expect(cls.name).toBe("MyClass");
    });
  });

  it("makeTemplate inserts a valid template row", async () => {
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
      expect(t.id).toBeDefined();
      expect(t.effectiveFrom).toBe("2026-05-11");
    });
  });

  it("makeShift inserts a valid shift row", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const s = await makeShift(tx, {
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-11",
        startTime: "08:00",
        endTime: "12:00",
      });
      expect(s.id).toBeDefined();
      expect(s.sourceTemplateId).toBeNull();
    });
  });
});
