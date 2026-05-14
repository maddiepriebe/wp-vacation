import type { DB } from "@/db/client";
import {
  classes,
  employees,
  scheduleShiftTemplates,
  scheduleShifts,
  type Class,
  type Employee,
  type NewClass,
  type NewEmployee,
  type NewScheduleShift,
  type NewScheduleShiftTemplate,
  type ScheduleShift,
  type ScheduleShiftTemplate,
} from "@/db/schema";

type DrizzleTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

function uniqueSuffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function makeClass(
  tx: DrizzleTx,
  overrides: Partial<NewClass> = {},
): Promise<Class> {
  const defaults: NewClass = {
    name: `Test Class ${uniqueSuffix()}`,
    ageGroup: "preschool",
    ratioTeacherToStudents: 4,
    maxGroupSize: 16,
  };
  const [row] = await tx
    .insert(classes)
    .values({ ...defaults, ...overrides })
    .returning();
  return row;
}

export async function makeEmployee(
  tx: DrizzleTx,
  overrides: Partial<NewEmployee> & { defaultClassId: string },
): Promise<Employee> {
  const defaults = {
    firstName: "Test",
    lastName: "User",
    email: `test-${crypto.randomUUID()}@example.com`,
    anniversaryDate: "2024-01-01",
    roleInClass: "teacher" as const,
    scheduledHoursPerWeek: "40",
  };
  const [row] = await tx
    .insert(employees)
    .values({ ...defaults, ...overrides })
    .returning();
  return row;
}

export async function makeTemplate(
  tx: DrizzleTx,
  overrides: Partial<NewScheduleShiftTemplate> & {
    classId: string;
    employeeId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    effectiveFrom: string;
  },
): Promise<ScheduleShiftTemplate> {
  const [row] = await tx
    .insert(scheduleShiftTemplates)
    .values(overrides)
    .returning();
  return row;
}

export async function makeShift(
  tx: DrizzleTx,
  overrides: Partial<NewScheduleShift> & {
    classId: string;
    employeeId: string;
    date: string;
    startTime: string;
    endTime: string;
  },
): Promise<ScheduleShift> {
  const [row] = await tx.insert(scheduleShifts).values(overrides).returning();
  return row;
}
