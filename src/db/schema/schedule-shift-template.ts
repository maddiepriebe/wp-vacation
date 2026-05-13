import {
  date,
  integer,
  pgTable,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { classes } from "./class";
import { employees } from "./employee";

// Recurring weekly schedule. Resolved per-week unless overridden by a
// concrete schedule_shift on a given date.
// day_of_week: 0=Mon … 4=Fri (Sat/Sun not used in v1, business is M–F).
export const scheduleShiftTemplates = pgTable("schedule_shift_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id")
    .notNull()
    .references(() => classes.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }),
  effectiveUntil: date("effective_until", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ScheduleShiftTemplate =
  typeof scheduleShiftTemplates.$inferSelect;
export type NewScheduleShiftTemplate =
  typeof scheduleShiftTemplates.$inferInsert;
