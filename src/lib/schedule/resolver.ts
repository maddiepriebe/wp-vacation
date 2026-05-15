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
