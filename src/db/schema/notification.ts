import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { notificationKindEnum, recipientTypeEnum } from "./enums";

// recipient_id is polymorphic (employee or admin), so no FK constraint.
// recipient_type discriminates which table to join against.
export const notifications = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientType: recipientTypeEnum("recipient_type").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  kind: notificationKindEnum("kind").notNull(),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  sentEmailAt: timestamp("sent_email_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
