import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { IntentionalRollback, txStorage } from "@/lib/actions/transactions";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";

async function rollbackAfter<T>(test: () => Promise<T>): Promise<T> {
  try {
    await db.transaction(async (tx) => {
      await txStorage.run(tx, async () => {
        const v = await test();
        throw new IntentionalRollback(v);
      });
    });
    throw new Error("unreachable");
  } catch (e) {
    if (e instanceof IntentionalRollback) return e.value as T;
    throw e;
  }
}

describe("runActionTx", () => {
  it("commits when handler returns ok:true (top-level call)", async () => {
    // Top-level: runActionTx opens a real transaction. We'll insert, return
    // ok:true, then verify the row exists, then manually delete to clean up.
    const result = await runActionTx<{ id: string }>(
      "test.commit",
      {},
      async (tx) => {
        const [row] = await tx
          .insert(classes)
          .values({
            name: `RX-commit-${crypto.randomUUID().slice(0, 8)}`,
            ageGroup: "preschool",
            ratioTeacherToStudents: 4,
            maxGroupSize: 16,
          })
          .returning();
        return { ok: true, data: { id: row.id } };
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, result.data.id),
    });
    expect(found?.id).toBe(result.data.id);

    // Clean up.
    await db.delete(classes).where(eq(classes.id, result.data.id));
  });

  it("rolls back when handler returns ok:false", async () => {
    let insertedId: string | undefined;

    const result = await runActionTx<unknown>("test.rollback", {}, async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `RX-rollback-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
      return {
        ok: false,
        error: { code: "validation", message: "intentional" },
      };
    });
    expect(result.ok).toBe(false);
    expect(insertedId).toBeDefined();

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("rolls back + returns 'internal' on unexpected throw", async () => {
    let insertedId: string | undefined;

    const result = await runActionTx<unknown>("test.throw", {}, async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `RX-throw-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal");

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("joins outer transaction as savepoint when ALS bound (ok:true → outer commits both)", async () => {
    // Simulate a "test" by manually binding ALS.
    let outerId: string | undefined;
    let innerId: string | undefined;

    const result = await rollbackAfter(async () => {
      // Inside outer tx; runActionTx should use a savepoint.
      const tx = txStorage.getStore()!;
      const [outer] = await tx
        .insert(classes)
        .values({
          name: `RX-outer-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      outerId = outer.id;

      const inner = await runActionTx<{ id: string }>(
        "test.savepoint.ok",
        {},
        async (innerTx) => {
          const [row] = await innerTx
            .insert(classes)
            .values({
              name: `RX-inner-${crypto.randomUUID().slice(0, 8)}`,
              ageGroup: "preschool",
              ratioTeacherToStudents: 4,
              maxGroupSize: 16,
            })
            .returning();
          return { ok: true, data: { id: row.id } };
        },
      );
      expect(inner.ok).toBe(true);
      if (inner.ok) innerId = inner.data.id;

      // Before outer rollback, both rows should be visible to the outer tx.
      const outerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, outerId!),
      });
      const innerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, innerId!),
      });
      expect(outerSeen?.id).toBe(outerId);
      expect(innerSeen?.id).toBe(innerId);

      return { outerId, innerId };
    });

    expect(result.outerId).toBeDefined();
    expect(result.innerId).toBeDefined();

    // After outer rollback, neither row should persist.
    const outerAfter = await db.query.classes.findFirst({
      where: eq(classes.id, result.outerId!),
    });
    const innerAfter = await db.query.classes.findFirst({
      where: eq(classes.id, result.innerId!),
    });
    expect(outerAfter).toBeUndefined();
    expect(innerAfter).toBeUndefined();
  });

  it("savepoint rollback (handler ok:false) does not abort outer transaction", async () => {
    let outerId: string | undefined;

    const result = await rollbackAfter(async () => {
      const tx = txStorage.getStore()!;
      const [outer] = await tx
        .insert(classes)
        .values({
          name: `RX-outer2-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      outerId = outer.id;

      const inner = await runActionTx<unknown>(
        "test.savepoint.fail",
        {},
        async (innerTx) => {
          await innerTx.insert(classes).values({
            name: `RX-inner2-${crypto.randomUUID().slice(0, 8)}`,
            ageGroup: "preschool",
            ratioTeacherToStudents: 4,
            maxGroupSize: 16,
          });
          return { ok: false, error: { code: "validation", message: "x" } };
        },
      );
      expect(inner.ok).toBe(false);

      // Outer row should still be visible — savepoint rolled back but outer is alive.
      const outerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, outerId!),
      });
      expect(outerSeen?.id).toBe(outerId);

      return outerId;
    });

    expect(result).toBeDefined();
  });

  it("does not log raw input — only allowlisted ids", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runActionTx<unknown>(
      "test.sanitize",
      { email: "leak@example.com", classId: "abc-123", note: "secret" },
      async () => {
        throw new Error("boom");
      },
    );

    // sanitizeContext + logInternalError use console.error in v1.
    const calls = logSpy.mock.calls.flat().map(String).join(" ");
    expect(calls).not.toContain("leak@example.com");
    expect(calls).not.toContain("secret");
    expect(calls).toContain("abc-123"); // classId is allowlisted
    expect(calls).toContain("test.sanitize");

    logSpy.mockRestore();
  });
});
