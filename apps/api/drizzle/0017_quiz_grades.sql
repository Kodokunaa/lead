CREATE TABLE "grade_question_scores" (
	"grade_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "grade_question_scores_grade_id_question_id_pk" PRIMARY KEY("grade_id","question_id"),
	CONSTRAINT "grade_question_scores_points_check" CHECK ("grade_question_scores"."points" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "grade_question_scores" ADD CONSTRAINT "grade_question_scores_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_question_scores" ADD CONSTRAINT "grade_question_scores_question_id_assessment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assessment_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_target_check" CHECK ("grades"."submission_id" is null or "grades"."attempt_id" is null);