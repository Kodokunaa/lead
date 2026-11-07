CREATE TYPE "public"."grade_status" AS ENUM('draft', 'released');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "grade_rubric_scores" (
	"grade_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	CONSTRAINT "grade_rubric_scores_grade_id_criterion_id_pk" PRIMARY KEY("grade_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"submission_id" uuid,
	"score" integer NOT NULL,
	"max_points" integer NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"status" "grade_status" DEFAULT 'draft' NOT NULL,
	"graded_by" uuid NOT NULL,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "grades_score_check" CHECK ("grades"."score" between 0 and "grades"."max_points"),
	CONSTRAINT "grades_released_check" CHECK (("grades"."status" = 'released') = ("grades"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"number" integer,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	CONSTRAINT "submissions_submitted_check" CHECK (("submissions"."status" = 'draft') = ("submissions"."number" is null and "submissions"."submitted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "accept_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_rubric_scores" ADD CONSTRAINT "grade_rubric_scores_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rubric_scores" ADD CONSTRAINT "grade_rubric_scores_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rubric_scores" ADD CONSTRAINT "grade_rubric_scores_level_id_rubric_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."rubric_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grades_student_idx" ON "grades" USING btree ("assessment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_number_idx" ON "submissions" USING btree ("assessment_id","student_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_one_draft_idx" ON "submissions" USING btree ("assessment_id","student_id") WHERE "submissions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_stored_name_idx" ON "submissions" USING btree ("stored_name");--> statement-breakpoint
CREATE INDEX "submissions_student_idx" ON "submissions" USING btree ("student_id");