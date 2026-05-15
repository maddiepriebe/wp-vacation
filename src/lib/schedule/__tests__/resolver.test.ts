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
      expect(tmpl?.start_time).toBe("13:00:00");
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
