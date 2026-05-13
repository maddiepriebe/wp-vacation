import { requireEmployee } from "@/lib/auth";

export default async function EmployeeNotificationsPage() {
  await requireEmployee();
  return (
    <div>
      <h1 className="text-lg font-semibold">Notifications</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Notifications inbox ships in Phase 5.
      </p>
    </div>
  );
}
