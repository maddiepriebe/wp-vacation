import {
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { balanceKindEnum, balanceSourceEnum } from "./enums";
import { employees } from "./employee";
import { admins } from "./admin";

// Append-only ledger of every change to vacation or personal balance.
// Sum of delta_hours per (employee_id, balance_kind) is the canonical balance;
// the *_hours_balance columns on Employee are a denormalized cache.
export const balanceTransactions = pgTable("balance_transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  balanceKind: balanceKindEnum("balance_kind").notNull(),
  deltaHours: numeric("delta_hours", { precision: 7, scale: 2 }).notNull(),
  source: balanceSourceEnum("source").notNull(),
  // request_id references time_off_request (Phase 3); kept as uuid for now.
  requestId: uuid("request_id"),
  adminId: uuid("admin_id").references(() => admins.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BalanceTransaction = typeof balanceTransactions.$inferSelect;
export type NewBalanceTransaction = typeof balanceTransactions.$inferInsert;
