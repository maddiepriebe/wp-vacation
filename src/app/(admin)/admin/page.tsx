import { requireAdmin } from "@/lib/auth";

export default async function AdminDashboardPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        KPI tiles, today&apos;s coverage, and activity log land in Phase 3.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Out today", "Pending requests", "Upcoming this week", "Low balance"].map(
          (title) => (
            <div key={title} className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">{title}</p>
              <p className="mt-2 text-2xl font-semibold text-muted-foreground">
                —
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
