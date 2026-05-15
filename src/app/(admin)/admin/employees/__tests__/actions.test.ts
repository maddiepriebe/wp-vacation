import { describe, expect, it, vi } from "vitest";
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

import { createEmployeeAction } from "@/app/(admin)/admin/employees/actions";

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
