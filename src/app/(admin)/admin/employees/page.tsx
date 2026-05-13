import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { employees, classes } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function AdminEmployeesPage() {
  await requireAdmin();
  const rows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.email,
      isActive: employees.isActive,
      clerkUserId: employees.clerkUserId,
      className: classes.name,
    })
    .from(employees)
    .leftJoin(classes, eq(classes.id, employees.defaultClassId))
    .orderBy(employees.lastName);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
        <button
          type="button"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
          disabled
        >
          Add Employee (Phase 2)
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Default Class</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No employees yet. Run <code>pnpm db:seed</code>.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  {r.firstName} {r.lastName}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-2">{r.className ?? "—"}</td>
                <td className="px-4 py-2">
                  {!r.isActive
                    ? "Inactive"
                    : r.clerkUserId
                      ? "Active"
                      : "Pending invite"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
