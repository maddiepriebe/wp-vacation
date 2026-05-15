import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  auditLog,
  balanceTransactions,
  employees,
} from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { makeAdmin, makeClass } from "@/test/fixtures";

// `revalidatePath` only works inside a Next.js request context. Stub it so
// Server Actions can call it freely from tests.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// `requireAdmin()` reads the Clerk session in production. For tests we mock
// it to return whatever admin we just inserted via fixtures. The mock factory
// closes over a mutable ref because each test inserts a fresh admin inside
// its withTx.
const currentAdminId = { value: "" };
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: currentAdminId.value }),
}));

// Mock the Clerk wrapper so invite tests don't reach the real SDK. Tests
// reset the implementations in their own beforeEach.
vi.mock("@/lib/clerk-invite", () => ({
  inviteUser: vi.fn(),
  resendInvite: vi.fn(),
}));

import {
  commitEmployeeImportAction,
  createEmployeeAction,
  parseEmployeeImportAction,
  recordHistoricalUsageAction,
  resendInviteAction,
  sendInviteAction,
} from "@/app/(admin)/admin/employees/actions";
import * as clerkInvite from "@/lib/clerk-invite";
import { utils, write as xlsxWrite } from "xlsx";

function makeFormData(rows: Array<Record<string, unknown>>): FormData {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = xlsxWrite(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  // Copy into a fresh ArrayBuffer so the Blob constructor's BlobPart type
  // is satisfied (Node's Buffer carries an ArrayBufferLike which TS treats
  // as possibly SharedArrayBuffer; Blob only accepts plain ArrayBuffer).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([ab], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "employees.xlsx",
  );
  return fd;
}

describe("createEmployeeAction", () => {
  it("inserts an employee with vacation+personal balance writes when entitled", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15", // 6+ years tenure
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, result.data.id));
      expect(emp.email).toBe("maria@example.com");
      expect(Number(emp.vacationHoursBalance)).toBe(160); // 20 days × 8 hrs
      expect(Number(emp.personalHoursBalance)).toBe(72); // 9 days × 8 hrs
      expect(emp.clerkUserId).toBeNull();

      const txns = await tx
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.employeeId, result.data.id));
      expect(txns).toHaveLength(2);
      expect(txns.every((t) => t.source === "initial_import")).toBe(true);

      const audit = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.create"),
            eq(auditLog.entityId, result.data.id),
          ),
        );
      expect(audit).toHaveLength(1);
    });
  });

  it("skips balance rows when entitlements are zero (under 6 months)", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const today = new Date().toISOString().slice(0, 10);
      const result = await createEmployeeAction({
        first_name: "New",
        last_name: "Hire",
        email: "new@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: today,
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, result.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(0);
      expect(Number(emp.personalHoursBalance)).toBe(0);

      const txns = await tx
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.employeeId, result.data.id));
      expect(txns).toHaveLength(0);
    });
  });

  it("returns validation error for bad email", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Bad",
        last_name: "Email",
        email: "not an email",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("returns class_missing for unknown default_class_id", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: "00000000-0000-0000-0000-000000000000",
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");
    });
  });

  it("returns validation error on case-insensitive email collision", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      const collision = await createEmployeeAction({
        first_name: "Maria2",
        last_name: "L.",
        email: "MARIA@example.com", // same address, different casing
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(collision.ok).toBe(false);
      if (!collision.ok) {
        expect(collision.error.code).toBe("validation");
        if (collision.error.code === "validation") {
          expect(collision.error.fieldErrors?.email).toBeDefined();
        }
      }
    });
  });
});

describe("parseEmployeeImportAction", () => {
  it("returns parsed rows + a sessionId for a valid sheet", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const fd = makeFormData([
        {
          first_name: "Maria",
          last_name: "L.",
          email: "maria@example.com",
          role_in_class: "teacher",
          default_class_name: "Pre-K",
          anniversary_date: "2025-01-15",
          scheduled_hours_per_week: 40,
        },
      ]);

      const result = await parseEmployeeImportAction(fd);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sessionId).toBeTruthy();
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0].ok).toBe(true);
    });
  });

  it("returns rows with per-row errors for invalid input", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const fd = makeFormData([
        {
          first_name: "Bad",
          last_name: "Role",
          email: "bad@example.com",
          role_in_class: "manager",
          default_class_name: "Pre-K",
          anniversary_date: "2025-01-15",
          scheduled_hours_per_week: 40,
        },
      ]);

      const result = await parseEmployeeImportAction(fd);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.rows[0].ok).toBe(false);
    });
  });

  it("returns validation error when no file is attached", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await parseEmployeeImportAction(new FormData());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});

describe("commitEmployeeImportAction", () => {
  it("inserts all rows with balances and a single summary audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      await makeClass(tx, { name: "Pre-K" });
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "maria@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2020-01-15", // 6+ years
            scheduled_hours_per_week: 40,
          },
          {
            first_name: "Jess",
            last_name: "T.",
            email: "jess@example.com",
            role_in_class: "assistant_teacher",
            default_class_name: "pre-k", // case-insensitive
            anniversary_date: "2025-11-15", // ≥ 6 months as of 2026-05-15+
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.ids).toHaveLength(2);

      const inserted = await tx.select().from(employees);
      expect(
        inserted.filter((e) =>
          ["maria@example.com", "jess@example.com"].includes(e.email),
        ),
      ).toHaveLength(2);

      const audits = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "employee.import"));
      expect(audits).toHaveLength(1);
      expect((audits[0].payload as { count: number }).count).toBe(2);
    });
  });

  it("fails the whole transaction with class_missing if a row's class is gone", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "no-class-row@example.com",
            role_in_class: "teacher",
            default_class_name: "ClassThatDoesNotExist",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");

      const inserted = await tx
        .select()
        .from(employees)
        .where(eq(employees.email, "no-class-row@example.com"));
      expect(inserted).toHaveLength(0);
    });
  });

  it("rejects invalid rows via re-parse", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Bad",
            last_name: "Role",
            email: "bad@example.com",
            role_in_class: "manager" as never,
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("rejects duplicate emails within the same import", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      await makeClass(tx, { name: "Pre-K" });
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "dup@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
          {
            first_name: "Maria2",
            last_name: "L.",
            email: "dup@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation");
        if (result.error.code === "validation") {
          expect(result.error.message).toBe("Duplicate emails within import");
        }
      }
    });
  });

  it("rejects when an email already exists in the database", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx, { name: "Pre-K" });
      currentAdminId.value = admin.id;

      // Pre-existing employee with the same email (case different).
      const pre = await createEmployeeAction({
        first_name: "Pre",
        last_name: "Existing",
        email: "exists@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!pre.ok) throw new Error("setup");

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "EXISTS@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation");
        if (result.error.code === "validation") {
          expect(result.error.message).toBe(
            "One or more emails already exist",
          );
        }
      }
    });
  });
});

describe("sendInviteAction", () => {
  beforeEach(() => {
    vi.mocked(clerkInvite.inviteUser).mockReset();
    vi.mocked(clerkInvite.resendInvite).mockReset();
  });

  it("creates an invitation and writes an audit row", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_abc" },
      });

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(true);

      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.invite_sent"),
            eq(auditLog.entityId, empResult.data.id),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(
        (audits[0].payload as { invitationId: string }).invitationId,
      ).toBe("inv_abc");
    });
  });

  it("returns not_found for missing employee", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      const result = await sendInviteAction({
        employeeId: "00000000-0000-0000-0000-000000000000",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });

  it("returns already_linked when clerk_user_id is set", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      await tx
        .update(employees)
        .set({ clerkUserId: "user_xyz" })
        .where(eq(employees.id, empResult.data.id));

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("already_linked");
    });
  });

  it("maps invite_pending from Clerk wrapper", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: false,
        error: { code: "invite_pending", message: "..." },
      });

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invite_pending");
    });
  });
});

describe("resendInviteAction", () => {
  beforeEach(() => {
    vi.mocked(clerkInvite.inviteUser).mockReset();
    vi.mocked(clerkInvite.resendInvite).mockReset();
  });

  it("revokes prior invite and writes employee.invite_resent audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_first" },
      });
      const first = await sendInviteAction({
        employeeId: empResult.data.id,
      });
      expect(first.ok).toBe(true);

      vi.mocked(clerkInvite.resendInvite).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_second" },
      });
      const result = await resendInviteAction({
        employeeId: empResult.data.id,
      });
      expect(result.ok).toBe(true);

      expect(vi.mocked(clerkInvite.resendInvite)).toHaveBeenCalledWith(
        expect.objectContaining({ previousInvitationId: "inv_first" }),
      );

      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.invite_resent"),
            eq(auditLog.entityId, empResult.data.id),
          ),
        );
      expect(audits).toHaveLength(1);
    });
  });

  it("resend requested but no prior invite audit exists → validation error", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      const result = await resendInviteAction({
        employeeId: empResult.data.id,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation");
        expect(result.error.message).toBe(
          "No prior invitation to resend; send a new invite first",
        );
      }
    });
  });

  it("resend with malformed prior audit payload returns validation, does not throw", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      // Insert an invite_sent audit row whose payload lacks invitationId.
      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId: admin.id,
        action: "employee.invite_sent",
        entityType: "employee",
        entityId: empResult.data.id,
        payload: {},
      });

      const result = await resendInviteAction({
        employeeId: empResult.data.id,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});

describe("recordHistoricalUsageAction", () => {
  it("writes a negative balance_transaction and decrements the bucket", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      // Mon-Fri of one week = 5 weekdays × 8h = 40h.
      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-11",
        endDate: "2026-05-15",
      });
      expect(result.ok).toBe(true);

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, empResult.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(160 - 40);

      const [txn] = await tx
        .select()
        .from(balanceTransactions)
        .where(
          and(
            eq(balanceTransactions.employeeId, empResult.data.id),
            eq(balanceTransactions.source, "historical_usage"),
          ),
        );
      expect(Number(txn.deltaHours)).toBe(-40);
    });
  });

  it("ignores weekends in the hour count", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      // Fri-Mon spans 2 weekdays (Fri + Mon) × 8 = 16h.
      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-15",
        endDate: "2026-05-18",
      });
      expect(result.ok).toBe(true);

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, empResult.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(160 - 16);
    });
  });

  it("rejects start > end", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-20",
        endDate: "2026-05-10",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("rejects dates outside the current anniversary year", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-08-01",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2025-01-15", // before the current anniversary year
        endDate: "2025-01-19",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("returns not_found for nonexistent employee", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await recordHistoricalUsageAction({
        employeeId: "00000000-0000-0000-0000-000000000000",
        balanceKind: "vacation",
        startDate: "2026-05-11",
        endDate: "2026-05-15",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });

  it("writes an audit row with all four payload fields", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");

      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "personal",
        startDate: "2026-05-11",
        endDate: "2026-05-12",
      });
      expect(result.ok).toBe(true);

      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.historical_usage_recorded"),
            eq(auditLog.entityId, empResult.data.id),
          ),
        );
      expect(audits).toHaveLength(1);
      const payload = audits[0].payload as Record<string, unknown>;
      expect(payload.balanceKind).toBe("personal");
      expect(payload.startDate).toBe("2026-05-11");
      expect(payload.endDate).toBe("2026-05-12");
      expect(payload.hours).toBe(16); // Mon + Tue × 8h
    });
  });
});
