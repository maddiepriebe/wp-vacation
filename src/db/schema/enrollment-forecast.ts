import {
  check,
  date,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classes } from "./class";

export const enrollmentForecasts = pgTable(
  "enrollment_forecast",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id),
    date: date("date", { mode: "string" }).notNull(),
    expectedStudents: integer("expected_students").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    classDateUnique: unique("enrollment_forecast_class_date_unique").on(
      table.classId,
      table.date,
    ),
    expectedStudentsCheck: check(
      "enrollment_forecast_expected_students_check",
      sql`${table.expectedStudents} >= 0`,
    ),
  }),
);

export type EnrollmentForecast = typeof enrollmentForecasts.$inferSelect;
export type NewEnrollmentForecast = typeof enrollmentForecasts.$inferInsert;
