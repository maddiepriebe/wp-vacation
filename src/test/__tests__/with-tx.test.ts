import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { runActionTx, txStorage } from "@/lib/actions/transactions";

describe("withTx", () => {
  it("returns the test body's value", async () => {
    const value = await withTx(async () => 42);
    expect(value).toBe(42);
  });

  it("rolls back direct writes via tx", async () => {
    let insertedId: string | undefined;

    await withTx(async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `WT-direct-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
    });

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("binds ALS so runActionTx joins as savepoint and rolls back with the test", async () => {
    let actionInsertedId: string | undefined;

    await withTx(async (_tx) => {
      const result = await runActionTx<{ id: string }>(
        "test.via-withTx",
        {},
        async (innerTx) => {
          const [row] = await innerTx
            .insert(classes)
            .values({
              name: `WT-action-${crypto.randomUUID().slice(0, 8)}`,
              ageGroup: "preschool",
              ratioTeacherToStudents: 4,
              maxGroupSize: 16,
            })
            .returning();
          return { ok: true, data: { id: row.id } };
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) actionInsertedId = result.data.id;
    });

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, actionInsertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("ALS is unset after withTx completes", async () => {
    await withTx(async () => {});
    expect(txStorage.getStore()).toBeUndefined();
  });
});
