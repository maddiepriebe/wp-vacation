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
  createShiftTemplateInputSchema,
  deleteShiftInputSchema,
  deleteShiftTemplateInputSchema,
  updateShiftInputSchema,
  updateShiftTemplateInputSchema,
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
