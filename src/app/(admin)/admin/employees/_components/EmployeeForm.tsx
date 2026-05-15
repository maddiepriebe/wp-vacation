"use client";

import type { Route } from "next";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type ClassOption = { id: string; name: string };

export type EmployeeFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "success"; id: string };

export function EmployeeForm({
  classes,
  action,
}: {
  classes: ClassOption[];
  action: (
    prev: EmployeeFormState,
    formData: FormData,
  ) => Promise<EmployeeFormState>;
}) {
  const [state, formAction] = useFormState<EmployeeFormState, FormData>(
    action,
    { status: "idle" },
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.push(`/admin/employees/${state.id}` as Route);
    }
  }, [state, router]);

  const fe = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.status === "error" && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <Field label="First name" name="first_name" errors={fe.first_name} />
      <Field label="Last name" name="last_name" errors={fe.last_name} />
      <Field
        label="Email"
        name="email"
        type="email"
        errors={fe.email}
      />
      <Field label="Phone (optional)" name="phone" errors={fe.phone} />

      <label className="block text-sm">
        Role in class
        <select
          name="role_in_class"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
        >
          <option value="teacher">Teacher</option>
          <option value="assistant_teacher">Assistant teacher</option>
        </select>
        <FieldErrors errors={fe.role_in_class} />
      </label>

      <label className="block text-sm">
        Default class
        <select
          name="default_class_id"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldErrors errors={fe.default_class_id} />
      </label>

      <Field
        label="Anniversary date (treated as hire date)"
        name="anniversary_date"
        type="date"
        errors={fe.anniversary_date}
      />
      <Field
        label="Scheduled hours per week"
        name="scheduled_hours_per_week"
        type="number"
        step="0.5"
        min="1"
        max="40"
        errors={fe.scheduled_hours_per_week}
      />

      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Add employee
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  step,
  min,
  max,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
  errors?: string[];
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2"
      />
      <FieldErrors errors={errors} />
    </label>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <span className="mt-1 block text-xs text-destructive">
      {errors.join(", ")}
    </span>
  );
}
