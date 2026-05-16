import { requireAdmin } from "@/lib/auth";
import { commitEnrollmentImportAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { EnrollmentUploadPreviewTable } from "../_components/EnrollmentUploadPreviewTable";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  await requireAdmin();
  const { id: classId } = await params;
  const { session } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Preview enrollment import</h1>
      <EnrollmentUploadPreviewTable
        classId={classId}
        sessionId={session ?? ""}
        action={commitEnrollmentImportAction}
      />
    </div>
  );
}
