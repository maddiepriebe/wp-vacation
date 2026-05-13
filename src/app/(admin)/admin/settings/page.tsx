import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { settings } from "@/db/schema";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [s] = await db.select().from(settings).limit(1);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Editable controls ship in Phase 3.
      </p>
      {!s ? (
        <p className="mt-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No settings row yet. Run <code>pnpm db:seed</code>.
        </p>
      ) : (
        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Low balance threshold">
            {s.lowBalanceThresholdHours} h
          </Field>
          <Field label="Vacation advance notice">
            {s.vacationAdvanceNoticeDays} days
          </Field>
          <Field label="Business hours start">{s.businessHoursStart}</Field>
          <Field label="Business hours end">{s.businessHoursEnd}</Field>
        </dl>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children}</dd>
    </div>
  );
}
