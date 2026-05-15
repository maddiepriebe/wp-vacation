import { requireAdmin } from "@/lib/auth";
import { UploadForm } from "../_components/UploadForm";
import { parseEmployeeImportAction } from "../actions";

export default async function UploadPage() {
  await requireAdmin();
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Bulk upload employees
      </h1>
      <p className="text-sm text-muted-foreground">
        XLSX or CSV. Required columns: first_name, last_name, email,
        role_in_class, default_class_name, anniversary_date,
        scheduled_hours_per_week. Vacation and personal balances are computed
        from anniversary_date — don&apos;t include them as columns.
      </p>
      <UploadForm action={parseEmployeeImportAction} />
    </div>
  );
}
