import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bereavementRelationEnum,
  timeOffStatusEnum,
  timeOffTypeEnum,
} from "./enums";
import { employees } from "./employee";
import { admins } from "./admin";

export const timeOffRequests = pgTable(
  "time_off_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    type: timeOffTypeEnum("type").notNull(),
    status: timeOffStatusEnum("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
    bereavementRelation: bereavementRelationEnum("bereavement_relation"),
    totalHours: numeric("total_hours", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    decisionBy: uuid("decision_by").references(() => admins.id),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    advanceNoticeOverridden: boolean("advance_notice_overridden")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    bereavementRelationIff: check(
      "time_off_request_bereavement_relation_iff",
      sql`(${table.type} = 'bereavement') = (${table.bereavementRelation} IS NOT NULL)`,
    ),
    decisionAtIff: check(
      "time_off_request_decision_at_iff",
      sql`(${table.status} IN ('approved', 'rejected')) = (${table.decisionAt} IS NOT NULL)`,
    ),
    decisionByRequiresAt: check(
      "time_off_request_decision_by_requires_at",
      sql`${table.decisionBy} IS NULL OR ${table.decisionAt} IS NOT NULL`,
    ),
    employeeStatusIdx: index("time_off_request_employee_status_idx").on(
      table.employeeId,
      table.status,
    ),
    statusSubmittedIdx: index("time_off_request_status_submitted_idx").on(
      table.status,
      table.submittedAt.desc(),
    ),
  }),
);

export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type NewTimeOffRequest = typeof timeOffRequests.$inferInsert;
