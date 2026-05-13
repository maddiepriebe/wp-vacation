import { requireEmployee } from "@/lib/auth";

export default async function EmployeeSchedulePage() {
  await requireEmployee();
  return (
    <div>
      <h1 className="text-lg font-semibold">My schedule</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Schedule view ships in Phase 2.
      </p>
    </div>
  );
}
