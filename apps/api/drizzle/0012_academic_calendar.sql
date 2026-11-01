CREATE TYPE "public"."calendar_event_kind" AS ENUM('assessment_period', 'grade_release', 'holiday', 'class_event');--> statement-breakpoint
CREATE TABLE "calendar_event_courses" (
	"event_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	CONSTRAINT "calendar_event_courses_event_id_course_id_pk" PRIMARY KEY("event_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "calendar_event_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_dates_check" CHECK ("calendar_events"."ends_on" is null or "calendar_events"."starts_on" <= "calendar_events"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "grading_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_periods_dates_check" CHECK ("grading_periods"."starts_on" <= "grading_periods"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "calendar_event_courses" ADD CONSTRAINT "calendar_event_courses_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_courses" ADD CONSTRAINT "calendar_event_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_periods" ADD CONSTRAINT "grading_periods_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_courses_course_idx" ON "calendar_event_courses" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "calendar_events_term_idx" ON "calendar_events" USING btree ("term_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_periods_term_name_idx" ON "grading_periods" USING btree ("term_id",lower("name"));