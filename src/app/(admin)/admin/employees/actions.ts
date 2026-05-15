"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { daysInRange, isISODateString, todayET } from "@/lib/dates";
import { addYears, parseISO } from "date-fns";
import { validateEmployeeImportSheet } from "@/lib/sheets/employee-import";
import type { ParsedRow } from "@/lib/sheets/parse";
import { inviteUser, resendInvite } from "@/lib/clerk-invite";
import {
  auditLog,
  balanceTransactions,
  classes,
  employees,
} from "@/db/schema";

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

const invitePayloadSchema = z.object({
  employeeId: z.string().uuid(),
});

// Guardrail A: the invitationId we read from a prior audit row must be a
// non-empty string. Anything else means the prior row is corrupt; bail with
// a validation error instead of throwing.
const inviteAuditPayloadSchema = z
  .object({ invitationId: z.string().min(1) })
  .passthrough();

export async function sendInviteAction(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const admin = await requireAdmin();
  const parsed = invitePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input" },
    };
  }
  const { employeeId } = parsed.data;

  return runActionTx("employee.invite_sent", parsed.data, async (tx) => {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId));
    if (!emp) {
      return {
        ok: false,
        error: { code: "not_found", message: "Employee not found" },
      };
    }
    if (emp.clerkUserId) {
      return {
        ok: false,
        error: {
          code: "already_linked",
          message: "Already linked to a Clerk user",
        },
      };
    }

    const inviteResult = await inviteUser({
      emailAddress: emp.email,
      publicMetadata: { employeeId: emp.id, role: "employee" },
    });
    if (!inviteResult.ok) return inviteResult;

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.invite_sent",
      targetId: emp.id,
      payload: { invitationId: inviteResult.data.invitationId },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return {
      ok: true,
      data: { invitationId: inviteResult.data.invitationId },
    };
  });
}

export async function resendInviteAction(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const admin = await requireAdmin();
  const parsed = invitePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Invalid input" },
    };
  }
  const { employeeId } = parsed.data;

  return runActionTx("employee.invite_resent", parsed.data, async (tx) => {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId));
    if (!emp) {
      return {
        ok: false,
        error: { code: "not_found", message: "Employee not found" },
      };
    }
    if (emp.clerkUserId) {
      return {
        ok: false,
        error: {
          code: "already_linked",
          message: "Already linked to a Clerk user",
        },
      };
    }

    // Guardrail A: find the most recent invite_sent / invite_resent row for
    // this employee. If none exists, validation error (NOT not_found) so the
    // UI can prompt the admin to send a new invite instead.
    const [latestInvite] = await tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "employee"),
          eq(auditLog.entityId, emp.id),
          inArray(auditLog.action, [
            "employee.invite_sent",
            "employee.invite_resent",
          ]),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    if (!latestInvite) {
      return {
        ok: false,
        error: {
          code: "validation",
          message:
            "No prior invitation to resend; send a new invite first",
        },
      };
    }

    // Guardrail A: validate the payload defensively. If the prior row is
    // missing `invitationId` (data corruption / older row format), bail with
    // a validation error rather than crashing the action.
    const payloadCheck = inviteAuditPayloadSchema.safeParse(
      latestInvite.payload,
    );
    if (!payloadCheck.success) {
      return {
        ok: false,
        error: {
          code: "validation",
          message:
            "Prior invitation record is malformed; send a new invite instead",
        },
      };
    }
    const prevId = payloadCheck.data.invitationId;

    const resendResult = await resendInvite({
      previousInvitationId: prevId,
      emailAddress: emp.email,
      publicMetadata: { employeeId: emp.id, role: "employee" },
    });
    if (!resendResult.ok) return resendResult;

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.invite_resent",
      targetId: emp.id,
      payload: {
        invitationId: resendResult.data.invitationId,
        previousInvitationId: prevId,
      },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return {
      ok: true,
      data: { invitationId: resendResult.data.invitationId },
    };
  });
}

const historicalUsageInputSchema = z
  .object({
    employeeId: z.string().uuid(),
    // Guardrail E: balance_kind must match Phase 1's enum exactly.
    balanceKind: z.enum(["vacation", "personal"]),
    startDate: z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date"),
    endDate: z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date"),
    note: z.string().optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "startDate must be on or before endDate",
    path: ["startDate"],
  });

function countWeekdays(startISO: string, endISO: string): number {
  let count = 0;
  for (const iso of daysInRange(startISO, endISO)) {
    const d = parseISO(iso);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

function currentAnniversaryYearRange(
  anniversaryISO: string,
  todayISO: string,
): [string, string] {
  const anniversary = parseISO(anniversaryISO);
  const today = parseISO(todayISO);
  // Walk forward year by year until the next anniversary is past today —
  // that gives the start of the current anniversary year cycle.
  let start = new Date(anniversary);
  while (true) {
    const next = addYears(start, 1);
    if (next > today) break;
    start = next;
  }
  const end = addYears(start, 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return [
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10),
  ];
}

export async function recordHistoricalUsageAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = historicalUsageInputSchema.safeParse(input);
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

  return runActionTx("employee.historical_usage", data, async (tx) => {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, data.employeeId));
    if (!emp) {
      return {
        ok: false,
        error: { code: "not_found", message: "Employee not found" },
      };
    }

    const today = todayET();
    const [yrStart, yrEnd] = currentAnniversaryYearRange(
      emp.anniversaryDate,
      today,
    );
    if (data.startDate < yrStart || data.endDate > yrEnd) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: `Dates must fall within the current anniversary year (${yrStart} to ${yrEnd})`,
          fieldErrors: { startDate: ["Out of anniversary year range"] },
        },
      };
    }

    const weekdays = countWeekdays(data.startDate, data.endDate);
    const hours = weekdays * 8;

    const [txn] = await tx
      .insert(balanceTransactions)
      .values({
        employeeId: emp.id,
        balanceKind: data.balanceKind,
        // Guardrail E: negative delta — this records hours already drawn.
        deltaHours: String(-hours),
        source: "historical_usage",
        adminId: admin.id,
        note:
          data.note ??
          `Historical usage ${data.startDate} to ${data.endDate}`,
      })
      .returning();

    const denormColumn =
      data.balanceKind === "vacation"
        ? employees.vacationHoursBalance
        : employees.personalHoursBalance;
    const setClause =
      data.balanceKind === "vacation"
        ? { vacationHoursBalance: sql`${denormColumn} - ${hours}` }
        : { personalHoursBalance: sql`${denormColumn} - ${hours}` };
    await tx
      .update(employees)
      .set(setClause)
      .where(eq(employees.id, emp.id));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.historical_usage_recorded",
      targetId: emp.id,
      // Guardrail E: payload carries all four fields so the adjustment can
      // be reconstructed forensically.
      payload: {
        balanceKind: data.balanceKind,
        startDate: data.startDate,
        endDate: data.endDate,
        hours,
      },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return { ok: true, data: { id: txn.id } };
  });
}
