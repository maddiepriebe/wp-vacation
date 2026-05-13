import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ageGroupEnum } from "./enums";

export const classes = pgTable("class", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ageGroup: ageGroupEnum("age_group").notNull(),
  ratioTeacherToStudents: integer("ratio_teacher_to_students"),
  maxGroupSize: integer("max_group_size"),
  isFloaterPool: boolean("is_floater_pool").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Class = typeof classes.$inferSelect;
export type NewClass = typeof classes.$inferInsert;
