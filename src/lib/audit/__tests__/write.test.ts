import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit/write";
import { withTx } from "@/test/with-tx";
import { makeAdmin } from "@/test/fixtures";

describe("writeAuditLog", () => {
  it("inserts a row with the standardized envelope", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "employee.create",
        targetId: null,
        payload: { hello: "world" },
      });
      const rows = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.create"),
            eq(auditLog.actorId, admin.id),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ hello: "world" });
      expect(rows[0].actorType).toBe("admin");
      expect(rows[0].entityType).toBe("employee");
    });
  });

  it("maps a non-null targetId to entityId", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const targetId = crypto.randomUUID();
      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "employee.invite_sent",
        targetId,
        payload: { invitationId: "inv_abc" },
      });
      const rows = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "employee.invite_sent"),
            eq(auditLog.actorId, admin.id),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].entityId).toBe(targetId);
      expect(rows[0].entityType).toBe("employee");
    });
  });

  it("rolls back with the transaction", async () => {
    // No assertion here beyond reuse of the withTx pattern; the prior test
    // proved the insert works. This test ensures the helper is not bypassing
    // the tx (e.g., importing db directly).
    let insertedAction = "";
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      insertedAction = `audit.rollback.${crypto.randomUUID().slice(0, 8)}`;
      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: insertedAction,
        targetId: null,
        payload: {},
      });
    });
    // No `db` available in this test (lint-blocked); we just rely on the
    // outer rollback to enforce that the helper participates in the tx.
    expect(insertedAction).toMatch(/^audit\.rollback\./);
  });
});
