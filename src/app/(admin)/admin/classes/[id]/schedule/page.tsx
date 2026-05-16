import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes, enrollmentForecasts } from "@/db/schema";
import {
  isISODateString,
  isMondayISODate,
  todayET,
  weekEnd,
  weekStartOf,
} from "@/lib/dates";
import { resolveTemplateWeek, resolveWeek } from "@/lib/schedule/resolver";
import type { ScheduleMode } from "@/lib/schedule/types";
import { ScheduleClient } from "./_components/ScheduleClient";

export default async function ClassSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; mode?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const sp = await searchParams;

  const today = todayET();
  const requestedWeek = sp.week;
  if (
    requestedWeek !== undefined &&
    (!isISODateString(requestedWeek) || !isMondayISODate(requestedWeek))
  ) {
    redirect(
      `/admin/classes/${classId}/schedule?week=${weekStartOf(today)}` as Route,
    );
  }
  const weekStartISO = requestedWeek ?? weekStartOf(today);
  const mode: ScheduleMode = sp.mode === "template" ? "template" : "week";

  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) notFound();

  const enrollmentRows = await db
    .select()
    .from(enrollmentForecasts)
    .where(
      and(
        eq(enrollmentForecasts.classId, classId),
        gte(enrollmentForecasts.date, weekStartISO),
        lte(enrollmentForecasts.date, weekEnd(weekStartISO)),
      ),
    );
  const enrollment = new Map<string, number>(
    enrollmentRows.map((r) => [r.date, r.expectedStudents]),
  );

  const shifts =
    mode === "template"
      ? await resolveTemplateWeek(classId, weekStartISO)
      : await resolveWeek(classId, weekStartISO);

  return (
    <ScheduleClient
      classId={classId}
      className={cls.name}
      weekStartISO={weekStartISO}
      mode={mode}
      initialShifts={shifts}
      enrollment={enrollment}
    />
  );
}
