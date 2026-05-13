import { date, pgTable, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { classes } from "./class";
import { employees } from "./employee";
import { scheduleShiftTemplates } from "./schedule-shift-template";

// Concrete shift on a specific date. Created either by template resolution
// (source_template_id set) or as a one-off (source_template_id null).
// A row here overrides the template for that (employee, date).
export const scheduleShifts = pgTable("schedule_shift", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id")
    .notNull()
    .references(() => classes.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  date: date("date", { mode: "string" }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  sourceTemplateId: uuid("source_template_id").references(
    () => scheduleShiftTemplates.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ScheduleShift = typeof scheduleShifts.$inferSelect;
export type NewScheduleShift = typeof scheduleShifts.$inferInsert;
