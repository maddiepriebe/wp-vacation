"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";
import {
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
