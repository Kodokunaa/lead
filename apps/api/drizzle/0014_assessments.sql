CREATE TYPE "public"."assessment_kind" AS ENUM('quiz', 'exam', 'assignment', 'project');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'moderate', 'hard');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('multiple_choice', 'written');--> statement-breakpoint
CREATE TABLE "assessment_objectives" (
	"assessment_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	CONSTRAINT "assessment_objectives_assessment_id_objective_id_pk" PRIMARY KEY("assessment_id","objective_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "question_kind" NOT NULL,
	"prompt" text NOT NULL,
	"points" integer NOT NULL,
	"difficulty" "difficulty" DEFAULT 'moderate' NOT NULL,
	"objective_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_questions_points_check" CHECK ("assessment_questions"."points" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"opens_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"time_limit_minutes" integer,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_time_limit_check" CHECK ("assessments"."time_limit_minutes" is null or "assessments"."time_limit_minutes" between 1 and 600),
	CONSTRAINT "assessments_attempts_check" CHECK ("assessments"."max_attempts" between 1 and 10),
	CONSTRAINT "assessments_window_check" CHECK ("assessments"."opens_at" is null or "assessments"."due_at" is null or "assessments"."due_at" > "assessments"."opens_at"),
	CONSTRAINT "assessments_publishable_check" CHECK ("assessments"."status" <> 'published' or ("assessments"."opens_at" is not null and "assessments"."due_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "question_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criterion_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"points" integer NOT NULL,
	"descriptor" text DEFAULT '' NOT NULL,
	CONSTRAINT "rubric_levels_points_check" CHECK ("rubric_levels"."points" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "assessment_objectives" ADD CONSTRAINT "assessment_objectives_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_objectives" ADD CONSTRAINT "assessment_objectives_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_choices" ADD CONSTRAINT "question_choices_question_id_assessment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assessment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_levels" ADD CONSTRAINT "rubric_levels_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_objectives_objective_idx" ON "assessment_objectives" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "assessment_questions_assessment_idx" ON "assessment_questions" USING btree ("assessment_id","position");--> statement-breakpoint
CREATE INDEX "assessments_section_idx" ON "assessments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "question_choices_question_idx" ON "question_choices" USING btree ("question_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "question_choices_one_correct_idx" ON "question_choices" USING btree ("question_id") WHERE "question_choices"."correct";--> statement-breakpoint
CREATE INDEX "rubric_criteria_assessment_idx" ON "rubric_criteria" USING btree ("assessment_id","position");--> statement-breakpoint
CREATE INDEX "rubric_levels_criterion_idx" ON "rubric_levels" USING btree ("criterion_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_levels_points_idx" ON "rubric_levels" USING btree ("criterion_id","points");