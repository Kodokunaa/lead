CREATE TYPE "public"."semester" AS ENUM('first', 'second', 'summer');--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year" text NOT NULL,
	"semester" "semester" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"units" integer NOT NULL,
	"program_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_year_semester_idx" ON "academic_terms" USING btree ("school_year","semester");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_current_idx" ON "academic_terms" USING btree ("current") WHERE "academic_terms"."current";--> statement-breakpoint
CREATE UNIQUE INDEX "courses_code_idx" ON "courses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "courses_program_idx" ON "courses" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_code_idx" ON "programs" USING btree (lower("code"));