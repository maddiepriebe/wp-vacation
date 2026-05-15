import { requireAdmin } from "@/lib/auth";
import { UploadPreviewTable } from "../../_components/UploadPreviewTable";
import { commitEmployeeImportAction } from "../../actions";

export default async function PreviewPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Preview import</h1>
      <UploadPreviewTable action={commitEmployeeImportAction} />
    </div>
  );
}
