CREATE TYPE "public"."bereavement_relation" AS ENUM('parent', 'sibling', 'spouse', 'child', 'grandparent');--> statement-breakpoint
CREATE TYPE "public"."time_off_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."time_off_type" AS ENUM('vacation', 'sick', 'bereavement', 'unpaid', 'unallocated');--> statement-breakpoint
ALTER TYPE "public"."balance_source" ADD VALUE 'historical_usage';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrollment_forecast" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expected_students" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_forecast_class_date_unique" UNIQUE("class_id","date"),
	CONSTRAINT "enrollment_forecast_expected_students_check" CHECK ("enrollment_forecast"."expected_students" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_off_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" time_off_type NOT NULL,
	"status" time_off_status DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"bereavement_relation" "bereavement_relation",
	"total_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"decision_by" uuid,
	"decision_at" timestamp with time zone,
	"decision_note" text,
	"advance_notice_overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_request_bereavement_relation_iff" CHECK (("time_off_request"."type" = 'bereavement') = ("time_off_request"."bereavement_relation" IS NOT NULL)),
	CONSTRAINT "time_off_request_decision_at_iff" CHECK (("time_off_request"."status" IN ('approved', 'rejected')) = ("time_off_request"."decision_at" IS NOT NULL)),
	CONSTRAINT "time_off_request_decision_by_requires_at" CHECK ("time_off_request"."decision_by" IS NULL OR "time_off_request"."decision_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_off_request_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"is_full_day" boolean NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	CONSTRAINT "time_off_request_day_request_date_unique" UNIQUE("request_id","date"),
	CONSTRAINT "time_off_request_day_hours_check" CHECK ("time_off_request_day"."hours" >= 0),
	CONSTRAINT "time_off_request_day_partial_day_range" CHECK ("time_off_request_day"."is_full_day" OR ("time_off_request_day"."start_time" IS NOT NULL AND "time_off_request_day"."end_time" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "employee" DROP CONSTRAINT "employee_email_unique";--> statement-breakpoint
ALTER TABLE "schedule_shift" DROP CONSTRAINT "schedule_shift_source_template_id_schedule_shift_template_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule_shift_template" ALTER COLUMN "effective_from" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrollment_forecast" ADD CONSTRAINT "enrollment_forecast_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_decision_by_admin_id_fk" FOREIGN KEY ("decision_by") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_off_request_day" ADD CONSTRAINT "time_off_request_day_request_id_time_off_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."time_off_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_off_request_employee_status_idx" ON "time_off_request" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_off_request_status_submitted_idx" ON "time_off_request" USING btree ("status","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_off_request_day_date_idx" ON "time_off_request_day" USING btree ("date");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_shift" ADD CONSTRAINT "schedule_shift_source_template_id_schedule_shift_template_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."schedule_shift_template"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_shift_template_class_effective_from_idx" ON "schedule_shift_template" USING btree ("class_id","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_shift_class_date_idx" ON "schedule_shift" USING btree ("class_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_shift_employee_date_idx" ON "schedule_shift" USING btree ("employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_email_lower_unique" ON "employee" (LOWER("email"));