import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { EmployeeForm, type EmployeeFormState } from "../_components/EmployeeForm";
import { createEmployeeAction } from "../actions";

async function submit(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  "use server";
  const input = {
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    role_in_class: formData.get("role_in_class"),
    default_class_id: formData.get("default_class_id"),
    anniversary_date: formData.get("anniversary_date"),
    scheduled_hours_per_week: Number(formData.get("scheduled_hours_per_week")),
  };
  const result = await createEmployeeAction(input);
  if (!result.ok) {
    return {
      status: "error",
      message: result.error.message,
      fieldErrors:
        result.error.code === "validation" ? result.error.fieldErrors : undefined,
    };
  }
  return { status: "success", id: result.data.id };
}

export default async function NewEmployeePage() {
  await requireAdmin();
  const classRows = await db
    .select({ id: classes.id, name: classes.name })
    .from(classes)
    .orderBy(classes.name);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add Employee</h1>
      <EmployeeForm classes={classRows} action={submit} />
    </div>
  );
}
