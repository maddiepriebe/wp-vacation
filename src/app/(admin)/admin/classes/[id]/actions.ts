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
