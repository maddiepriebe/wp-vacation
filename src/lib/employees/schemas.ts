import { z } from "zod";
import { isISODateString } from "@/lib/dates";
import { normalizeEmail } from "@/lib/employees/normalize";

const roleEnum = z.enum(["teacher", "assistant_teacher"]);
const isoDate = z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date");
const scheduledHours = z.number().positive().max(40);

const baseFields = {
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.string().email().transform(normalizeEmail),
  phone: z.string().trim().optional(),
  role_in_class: roleEnum,
  anniversary_date: isoDate,
  scheduled_hours_per_week: scheduledHours,
};

export const employeeInputSchema = z.object({
  ...baseFields,
  default_class_id: z.string().uuid(),
});

export const employeeImportRowSchema = z.object({
  ...baseFields,
  default_class_name: z.string().trim().min(1),
});

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type EmployeeImportRow = z.infer<typeof employeeImportRowSchema>;
