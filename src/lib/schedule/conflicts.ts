import { parse } from "date-fns";
import { timeToMinutes } from "@/lib/dates";
import type { ConflictReason } from "@/lib/actions/errors";
import type {
  ConflictContext,
  ShiftCandidate,
  TemplateCandidate,
  TemplateLike,
} from "@/lib/schedule/types";

function overlapsTime(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = timeToMinutes(aStart);
  const aE = timeToMinutes(aEnd);
  const bS = timeToMinutes(bStart);
  const bE = timeToMinutes(bEnd);
  return aS < bE && bS < aE;
}

function dayOfWeekOf(isoDate: string): number {
  // 0 = Monday, ... 4 = Friday (matches schedule_shift_template.day_of_week)
  // JS getDay: 0 = Sunday, 1 = Monday. Convert.
  const d = parse(isoDate, "yyyy-MM-dd", new Date());
  const jsDow = d.getDay();
  // Sun=0 -> -1 (off-week); Mon=1 -> 0; Tue=2 -> 1; ... Fri=5 -> 4; Sat=6 -> 5 (off-week)
  return jsDow - 1;
}

function templateActiveOnOrAfter(t: TemplateLike, dateISO: string): boolean {
  return t.effectiveFrom <= dateISO && (t.effectiveUntil === null || t.effectiveUntil >= dateISO);
}

function templateRangeOverlapsOpenEnded(t: TemplateLike, fromISO: string): boolean {
  return t.effectiveUntil === null || t.effectiveUntil >= fromISO;
}

export function detectShiftConflicts(
  candidate: ShiftCandidate | TemplateCandidate,
  ctx: ConflictContext,
): ConflictReason[] {
  const out: ConflictReason[] = [];

  if (candidate.kind === "shift") {
    // Rule (a): cross-class shifts on the same date with overlapping times.
    for (const s of ctx.crossClassShifts) {
      if (ctx.excludeShiftId && s.id === ctx.excludeShiftId) continue;
      if (s.classId === candidate.classId) continue; // (b) same-class same-slot is allowed
      if (s.employeeId !== candidate.employeeId) continue;
      if (s.date !== candidate.date) continue;
      if (!overlapsTime(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) continue;
      out.push({
        rule: "a",
        otherClassId: s.classId,
        otherId: s.id,
        otherWindow: { start: s.startTime, end: s.endTime },
      });
    }

    // Rules (c) & (d): same-class templates covering this date with overlapping times.
    const dow = dayOfWeekOf(candidate.date);
    for (const t of ctx.sameClassTemplates) {
      if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
      if (t.classId !== candidate.classId) continue;
      if (t.employeeId !== candidate.employeeId) continue;
      if (t.dayOfWeek !== dow) continue;
      if (!templateActiveOnOrAfter(t, candidate.date)) continue;
      if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
      const identical = t.startTime === candidate.startTime && t.endTime === candidate.endTime;
      out.push(
        identical
          ? { rule: "d", otherId: t.id }
          : { rule: "c", otherTemplateId: t.id, otherWindow: { start: t.startTime, end: t.endTime } },
      );
    }
    return out;
  }

  // Template candidate.
  // Rule (a): cross-class templates on the same day-of-week with overlapping times and overlapping range.
  for (const t of ctx.crossClassTemplates) {
    if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
    if (t.classId === candidate.classId) continue;
    if (t.employeeId !== candidate.employeeId) continue;
    if (t.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!templateRangeOverlapsOpenEnded(t, candidate.effectiveFromISO)) continue;
    if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
    out.push({
      rule: "a",
      otherClassId: t.classId,
      otherId: t.id,
      otherWindow: { start: t.startTime, end: t.endTime },
    });
  }

  // Rules (c) & (d): same-class templates, open-ended range overlap.
  for (const t of ctx.sameClassTemplates) {
    if (ctx.excludeTemplateId && t.id === ctx.excludeTemplateId) continue;
    if (t.classId !== candidate.classId) continue;
    if (t.employeeId !== candidate.employeeId) continue;
    if (t.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!templateRangeOverlapsOpenEnded(t, candidate.effectiveFromISO)) continue;
    if (!overlapsTime(candidate.startTime, candidate.endTime, t.startTime, t.endTime)) continue;
    const identical = t.startTime === candidate.startTime && t.endTime === candidate.endTime;
    out.push(
      identical
        ? { rule: "d", otherId: t.id }
        : { rule: "c", otherTemplateId: t.id, otherWindow: { start: t.startTime, end: t.endTime } },
    );
  }
  return out;
}
