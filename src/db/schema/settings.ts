import {
  check,
  integer,
  pgTable,
  time,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Singleton: enforced by a CHECK constraint pinning id = 1.
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    lowBalanceThresholdHours: integer("low_balance_threshold_hours")
      .notNull()
      .default(16),
    vacationAdvanceNoticeDays: integer("vacation_advance_notice_days")
      .notNull()
      .default(14),
    businessHoursStart: time("business_hours_start")
      .notNull()
      .default("07:00:00"),
    businessHoursEnd: time("business_hours_end").notNull().default("17:00:00"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

export type Settings = typeof settings.$inferSelect;
