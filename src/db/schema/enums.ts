import { pgEnum } from "drizzle-orm/pg-core";

export const ageGroupEnum = pgEnum("age_group", [
  "infant",
  "toddler",
  "preschool",
  "floater_pool",
]);

export const roleInClassEnum = pgEnum("role_in_class", [
  "teacher",
  "assistant_teacher",
]);

export const adminRoleEnum = pgEnum("admin_role", [
  "owner",
  "hr",
  "director",
]);

export const recipientTypeEnum = pgEnum("recipient_type", [
  "employee",
  "admin",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "vacation_request_submitted",
  "sick_day_logged",
  "bereavement_logged",
  "request_approved",
  "request_rejected",
  "upcoming_leaves_digest",
  "day_before_leave_reminder",
  "low_balance_crossed",
  "new_employee_invite",
  "anniversary_balance_reset",
]);

export const balanceKindEnum = pgEnum("balance_kind", ["vacation", "personal"]);

export const balanceSourceEnum = pgEnum("balance_source", [
  "initial_import",
  "anniversary_reset",
  "tenure_tier_bump",
  "vacation_approval",
  "vacation_withdrawal",
  "sick_log",
  "bereavement_log",
  "admin_adjustment",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "employee",
  "admin",
  "system",
]);
