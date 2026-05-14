import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { timeOffRequests } from "./time-off-request";

export const timeOffRequestDays = pgTable(
  "time_off_request_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => timeOffRequests.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    isFullDay: boolean("is_full_day").notNull(),
    isHoliday: boolean("is_holiday").notNull().default(false),
    startTime: time("start_time"),
    endTime: time("end_time"),
  },
  (table) => ({
    hoursCheck: check(
      "time_off_request_day_hours_check",
      sql`${table.hours} >= 0`,
    ),
    partialDayNeedsRange: check(
      "time_off_request_day_partial_day_range",
      sql`${table.isFullDay} OR (${table.startTime} IS NOT NULL AND ${table.endTime} IS NOT NULL)`,
    ),
    requestDateUnique: unique("time_off_request_day_request_date_unique").on(
      table.requestId,
      table.date,
    ),
    dateIdx: index("time_off_request_day_date_idx").on(table.date),
  }),
);

export type TimeOffRequestDay = typeof timeOffRequestDays.$inferSelect;
export type NewTimeOffRequestDay = typeof timeOffRequestDays.$inferInsert;
