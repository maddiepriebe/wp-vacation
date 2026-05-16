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
import { resolveWeek } from "@/lib/schedule/resolver";
import { PrintLayout } from "./_components/PrintLayout";

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const sp = await searchParams;
  const today = todayET();
  if (
    sp.week !== undefined &&
    (!isISODateString(sp.week) || !isMondayISODate(sp.week))
  ) {
    redirect(
      `/admin/classes/${classId}/schedule/print?week=${weekStartOf(today)}` as Route,
    );
  }
  const weekStartISO = sp.week ?? weekStartOf(today);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) notFound();
  const shifts = await resolveWeek(classId, weekStartISO);
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

  return (
    <PrintLayout
      className={cls.name}
      weekStartISO={weekStartISO}
      shifts={shifts}
      enrollment={enrollment}
    />
  );
}
