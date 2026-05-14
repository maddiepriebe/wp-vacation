import { db } from "@/db/client";
import {
  IntentionalRollback,
  txStorage,
} from "@/lib/actions/transactions";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTx<T>(
  test: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return await db
    .transaction(async (tx) =>
      txStorage.run(tx, async () => {
        const value = await test(tx);
        throw new IntentionalRollback(value);
      }),
    )
    .catch((e) => {
      if (e instanceof IntentionalRollback) return e.value as T;
      throw e;
    });
}
