import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/db/client";
import type { ActionResult } from "@/lib/actions/errors";

// Drizzle's transaction parameter doesn't have a clean exported type in
// our version; we infer it from the callback signature.
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const txStorage = new AsyncLocalStorage<DrizzleTx>();

export class IntentionalRollback<T> extends Error {
  constructor(public value: T) {
    super("intentional-rollback");
  }
}

export function dbOrTx(): typeof db | DrizzleTx {
  return txStorage.getStore() ?? db;
}

const SANITIZE_ALLOWLIST = [
  "classId",
  "employeeId",
  "shiftId",
  "templateId",
  "sessionId",
  "mode",
  "weekStartISO",
  "sourceWeekStartISO",
  "effectiveFromISO",
  "targetWeekStartISO",
  "date",
];

function sanitizeContext(
  actionName: string,
  input: unknown,
): Record<string, unknown> {
  const safe: Record<string, unknown> = { action: actionName };
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of SANITIZE_ALLOWLIST) {
      if (key in (input as object)) {
        safe[key] = (input as Record<string, unknown>)[key];
      }
    }
  }
  return safe;
}

async function logInternalError(
  err: unknown,
  ctx: Record<string, unknown>,
): Promise<void> {
  // v1 logger: console.error. Replace with structured logger later if needed.
  // Stringify the payload so spies and downstream log aggregators see the
  // allowlisted fields without relying on console's auto-inspection.
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    "[runActionTx:internal]",
    JSON.stringify({ message, ...ctx }),
  );
}

export async function runActionTx<T>(
  actionName: string,
  input: unknown,
  handler: (tx: DrizzleTx) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const outer = txStorage.getStore();
  const runIn = outer
    ? outer.transaction.bind(outer)
    : db.transaction.bind(db);

  try {
    return await runIn(async (tx) =>
      txStorage.run(tx, async () => {
        const result = await handler(tx);
        if (!result.ok) throw new IntentionalRollback(result);
        return result;
      }),
    );
  } catch (e) {
    if (e instanceof IntentionalRollback) {
      return e.value as ActionResult<T>;
    }
    await logInternalError(e, sanitizeContext(actionName, input));
    return {
      ok: false,
      error: { code: "internal", message: "Unexpected error" },
    };
  }
}
