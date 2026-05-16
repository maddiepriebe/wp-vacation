import { requireAdmin } from "@/lib/auth";
import { parseEnrollmentImportAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { EnrollmentUploadForm } from "./_components/EnrollmentUploadForm";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: classId } = await params;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Enrollment forecast upload</h1>
      <p className="text-sm text-muted-foreground">
        Upload a sheet with columns <code>date</code> and <code>expected_students</code>. Dates must be unique per class.
      </p>
      <EnrollmentUploadForm classId={classId} action={parseEnrollmentImportAction} />
    </div>
  );
}
