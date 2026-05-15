"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";
import { z } from "zod";
import {
  employeeImportRowSchema,
  employeeInputSchema,
  type EmployeeImportRow,
} from "@/lib/employees/schemas";
import {
  computePersonalEntitlement,
  computeVacationEntitlement,
} from "@/lib/balances/entitlements";
import { writeAuditLog } from "@/lib/audit/write";
import { todayET } from "@/lib/dates";
import { validateEmployeeImportSheet } from "@/lib/sheets/employee-import";
import type { ParsedRow } from "@/lib/sheets/parse";
import { balanceTransactions, classes, employees } from "@/db/schema";

export async function createEmployeeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const data = parsed.data;

  return runActionTx("employee.create", data, async (tx) => {
    const [cls] = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.id, data.default_class_id));
    if (!cls) {
      return {
        ok: false,
        error: {
          code: "class_missing",
          message: "Default class does not exist",
        },
      };
    }

    // Check email collision on LOWER(email).
    const [collision] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(sql`LOWER(${employees.email}) = LOWER(${data.email})`);
    if (collision) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "Email already in use",
          fieldErrors: { email: ["Email already in use"] },
        },
      };
    }

    const today = todayET();
    const vacationHours = computeVacationEntitlement(
      data.anniversary_date,
      today,
      data.scheduled_hours_per_week,
    );
    const personalHours = computePersonalEntitlement(
      data.anniversary_date,
      today,
      data.scheduled_hours_per_week,
    );

    const [emp] = await tx
      .insert(employees)
      .values({
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone ?? null,
        anniversaryDate: data.anniversary_date,
        defaultClassId: data.default_class_id,
        roleInClass: data.role_in_class,
        scheduledHoursPerWeek: String(data.scheduled_hours_per_week),
        vacationHoursBalance: String(vacationHours),
        personalHoursBalance: String(personalHours),
      })
      .returning();

    if (vacationHours > 0) {
      await tx.insert(balanceTransactions).values({
        employeeId: emp.id,
        balanceKind: "vacation",
        deltaHours: String(vacationHours),
        source: "initial_import",
        note: "Initial entitlement on onboarding",
      });
    }
    if (personalHours > 0) {
      await tx.insert(balanceTransactions).values({
        employeeId: emp.id,
        balanceKind: "personal",
        deltaHours: String(personalHours),
        source: "initial_import",
        note: "Initial entitlement on onboarding",
      });
    }

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.create",
      targetId: emp.id,
      payload: {
        email: emp.email,
        anniversaryDate: emp.anniversaryDate,
        defaultClassId: emp.defaultClassId,
        roleInClass: emp.roleInClass,
        scheduledHoursPerWeek: emp.scheduledHoursPerWeek,
        vacationHoursBalance: emp.vacationHoursBalance,
        personalHoursBalance: emp.personalHoursBalance,
      },
    });

    revalidatePath("/admin/employees");
    return { ok: true, data: { id: emp.id } };
  });
}

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function parseEmployeeImportAction(
  formData: FormData,
): Promise<
  ActionResult<{ sessionId: string; rows: ParsedRow<EmployeeImportRow>[] }>
> {
  // No DB writes — admin auth is the only side-effect. Therefore no
  // runActionTx wrapper (Guardrail C).
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return {
      ok: false,
      error: { code: "validation", message: "No file attached" },
    };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      error: { code: "validation", message: "File too large (>5MB)" },
    };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = validateEmployeeImportSheet(buf);

  return {
    ok: true,
    data: {
      sessionId: crypto.randomUUID(),
      rows: result.rows,
    },
  };
}

const commitInputSchema = z.object({
  sessionId: z.string().uuid(),
  rows: z.array(employeeImportRowSchema).min(1),
});

export async function commitEmployeeImportAction(
  input: unknown,
): Promise<ActionResult<{ ids: string[] }>> {
  const admin = await requireAdmin();
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid commit payload",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { sessionId, rows } = parsed.data;

  // Guardrail B (within-import duplicate detection): the parser already
  // lowercased every email, so we can dedupe with a plain Set.
  const seen = new Set<string>();
  const dupErrors: string[] = [];
  for (const row of rows) {
    if (seen.has(row.email)) {
      dupErrors.push(`Email "${row.email}" appears more than once`);
    } else {
      seen.add(row.email);
    }
  }
  if (dupErrors.length > 0) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Duplicate emails within import",
        fieldErrors: { rows: dupErrors },
      },
    };
  }

  return runActionTx("employee.import", { sessionId }, async (tx) => {
    // Guardrail B (existing-employee collision): one query for the whole
    // batch. At a ~35-row scale we just load every candidate match and
    // filter in JS to keep the SQL simple.
    const candidateEmails = Array.from(seen);
    const existingRows = await tx
      .select({ email: employees.email })
      .from(employees)
      .where(
        sql`LOWER(${employees.email}) IN (${sql.join(
          candidateEmails.map((e) => sql`LOWER(${e})`),
          sql`, `,
        )})`,
      );
    if (existingRows.length > 0) {
      const conflicting = existingRows.map((r) => r.email);
      return {
        ok: false,
        error: {
          code: "validation",
          message: "One or more emails already exist",
          fieldErrors: { rows: conflicting },
        },
      };
    }

    // Build a lower(class_name) → class_id map for the classes referenced.
    const allClasses = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes);
    const byLowerName = new Map(
      allClasses.map((c) => [c.name.toLowerCase(), c.id]),
    );

    const ids: string[] = [];
    const today = todayET();

    for (const row of rows) {
      const classId = byLowerName.get(row.default_class_name.toLowerCase());
      if (!classId) {
        return {
          ok: false,
          error: {
            code: "class_missing",
            message: `Class "${row.default_class_name}" not found`,
          },
        };
      }

      const vacationHours = computeVacationEntitlement(
        row.anniversary_date,
        today,
        row.scheduled_hours_per_week,
      );
      const personalHours = computePersonalEntitlement(
        row.anniversary_date,
        today,
        row.scheduled_hours_per_week,
      );

      const [emp] = await tx
        .insert(employees)
        .values({
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone ?? null,
          anniversaryDate: row.anniversary_date,
          defaultClassId: classId,
          roleInClass: row.role_in_class,
          scheduledHoursPerWeek: String(row.scheduled_hours_per_week),
          vacationHoursBalance: String(vacationHours),
          personalHoursBalance: String(personalHours),
        })
        .returning();

      if (vacationHours > 0) {
        await tx.insert(balanceTransactions).values({
          employeeId: emp.id,
          balanceKind: "vacation",
          deltaHours: String(vacationHours),
          source: "initial_import",
          note: "Initial entitlement on onboarding (bulk import)",
        });
      }
      if (personalHours > 0) {
        await tx.insert(balanceTransactions).values({
          employeeId: emp.id,
          balanceKind: "personal",
          deltaHours: String(personalHours),
          source: "initial_import",
          note: "Initial entitlement on onboarding (bulk import)",
        });
      }

      ids.push(emp.id);
    }

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.import",
      targetId: null,
      payload: { count: ids.length, sessionId },
    });

    revalidatePath("/admin/employees");
    return { ok: true, data: { ids } };
  });
}
