import {
  boolean,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { roleInClassEnum } from "./enums";
import { classes } from "./class";

export const employees = pgTable("employee", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  anniversaryDate: date("anniversary_date", { mode: "string" }).notNull(),
  defaultClassId: uuid("default_class_id")
    .notNull()
    .references(() => classes.id),
  roleInClass: roleInClassEnum("role_in_class").notNull(),
  scheduledHoursPerWeek: numeric("scheduled_hours_per_week", {
    precision: 5,
    scale: 2,
  }).notNull(),
  vacationHoursBalance: numeric("vacation_hours_balance", {
    precision: 7,
    scale: 2,
  })
    .notNull()
    .default("0"),
  personalHoursBalance: numeric("personal_hours_balance", {
    precision: 7,
    scale: 2,
  })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  clerkUserId: text("clerk_user_id").unique(),
  lastLowBalanceNotifiedAt: timestamp("last_low_balance_notified_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
