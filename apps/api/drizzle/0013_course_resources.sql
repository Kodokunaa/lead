CREATE TYPE "public"."resource_status" AS ENUM('pending', 'approved', 'returned', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TABLE "resource_objectives" (
	"resource_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	CONSTRAINT "resource_objectives_resource_id_objective_id_pk" PRIMARY KEY("resource_id","objective_id")
);
--> statement-breakpoint
CREATE TABLE "resource_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_name" text,
	"stored_name" text,
	"content_type" text,
	"size_bytes" integer,
	"sha256" text,
	"url" text,
	"status" "resource_status" DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "resource_versions_kind_check" CHECK (("resource_versions"."stored_name" is not null and "resource_versions"."url" is null) or ("resource_versions"."stored_name" is null and "resource_versions"."url" is not null))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_objectives" ADD CONSTRAINT "resource_objectives_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_objectives" ADD CONSTRAINT "resource_objectives_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_module_id_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_number_idx" ON "resource_versions" USING btree ("resource_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_one_pending_idx" ON "resource_versions" USING btree ("resource_id") WHERE "resource_versions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_one_approved_idx" ON "resource_versions" USING btree ("resource_id") WHERE "resource_versions"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "resources_course_idx" ON "resources" USING btree ("course_id");