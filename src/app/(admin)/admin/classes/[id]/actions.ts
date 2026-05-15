"use server";

import { and, eq, gte, lte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult, ConflictReason } from "@/lib/actions/errors";
import { writeAuditLog } from "@/lib/audit/write";
import {
  classes,
  employees,
  scheduleShiftTemplates,
  scheduleShifts,
} from "@/db/schema";
import { detectShiftConflicts } from "@/lib/schedule/conflicts";
import { applyClosureRule, normTime } from "@/lib/schedule/closure";
import { resolveWeek } from "@/lib/schedule/resolver";
import { addDaysISO, todayET, weekEnd, weekStartOf } from "@/lib/dates";
import {
  copyWeekInputSchema,
  createShiftInputSchema,
  createShiftTemplateInputSchema,
  deleteShiftInputSchema,
  deleteShiftTemplateInputSchema,
  moveShiftInputSchema,
  saveAsTemplateInputSchema,
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

export async function moveShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = moveShiftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const data = parsed.data;

  return runActionTx("shift.move", { shiftId: data.shiftId, date: data.date }, async (tx) => {
    const [existing] = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.id, data.shiftId));
    if (!existing) return { ok: false, error: { code: "not_found", message: "Shift not found" } };

    const ctx = await loadClassesEmployeesTemplatesForShift(tx, {
      classId: existing.classId,
      employeeId: existing.employeeId,
      date: data.date,
    });

    const conflicts = detectShiftConflicts(
      {
        kind: "shift",
        classId: existing.classId,
        employeeId: existing.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
      },
      {
        crossClassShifts: ctx.crossClassShifts,
        crossClassTemplates: [],
        sameClassTemplates: ctx.sameClassTemplates,
        excludeShiftId: data.shiftId,
        excludeTemplateId: existing.sourceTemplateId ?? undefined,
      },
    );
    if (conflicts.length > 0) {
      return { ok: false, error: { code: "conflict", message: "Move target has conflicts", conflicts } };
    }

    await tx
      .update(scheduleShifts)
      .set({
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        updatedAt: new Date(),
      })
      .where(eq(scheduleShifts.id, data.shiftId));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "shift.move",
      targetId: data.shiftId,
      payload: {
        before: { date: existing.date, startTime: existing.startTime, endTime: existing.endTime },
        after: { date: data.date, startTime: data.startTime, endTime: data.endTime },
      },
    });

    revalidatePath(`/admin/classes/${existing.classId}/schedule`);
    return { ok: true, data: { id: data.shiftId } };
  });
}

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
