import { and, eq, isNull, lt } from "drizzle-orm";
import { addDaysISO } from "@/lib/dates";
import { scheduleShiftTemplates } from "@/db/schema";
import type { db } from "@/db/client";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Postgres `time` columns stringify to 'HH:MM:SS'; many helpers expect 'HH:MM'.
// Exported so non-detector callers (saveAsTemplate, copyWeek) normalize the same way
// the conflict detector does internally.
export function normTime(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

export async function applyClosureRule(
  tx: DrizzleTx,
  classId: string,
  newEffectiveFromISO: string,
): Promise<{ closedTemplateIds: string[] }> {
  const closeOn = addDaysISO(newEffectiveFromISO, -1);

  const rows = await tx
    .update(scheduleShiftTemplates)
    .set({ effectiveUntil: closeOn, updatedAt: new Date() })
    .where(
      and(
        eq(scheduleShiftTemplates.classId, classId),
        isNull(scheduleShiftTemplates.effectiveUntil),
        lt(scheduleShiftTemplates.effectiveFrom, newEffectiveFromISO),
      ),
    )
    .returning({ id: scheduleShiftTemplates.id });

  return { closedTemplateIds: rows.map((r) => r.id) };
}
