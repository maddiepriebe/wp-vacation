import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { holidays } from "@/db/schema";

export default async function AdminHolidaysPage() {
  await requireAdmin();
  const rows = await db.select().from(holidays).orderBy(holidays.date);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Holidays</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Add / copy-from-previous-year flows ship in Phase 3.
      </p>
      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No holidays yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.date}</td>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2">{r.isPaid ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
