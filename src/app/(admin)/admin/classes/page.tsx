import Link from "next/link";
import type { Route } from "next";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes } from "@/db/schema";

export default async function AdminClassesPage() {
  await requireAdmin();
  const rows = await db.select().from(classes).orderBy(classes.name);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Classes &amp; Schedules
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Schedule grid (drag-and-drop, templates, copy-week) ships in Phase 2.
      </p>
      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Age Group</th>
              <th className="px-4 py-2">Ratio</th>
              <th className="px-4 py-2">Max Group</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No classes yet. Run <code>pnpm db:seed</code>.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/classes/${r.id}/schedule` as Route}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 capitalize">
                    {r.ageGroup.replace("_", " ")}
                  </td>
                  <td className="px-4 py-2">
                    {r.ratioTeacherToStudents
                      ? `1:${r.ratioTeacherToStudents}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2">{r.maxGroupSize ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
