import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  usesQuestions,
  type AssessmentClass,
  type AssessmentCreate,
  type AssessmentDetails,
  type AssessmentList,
  type AssessmentSettings,
  type AssessmentSummary,
  type AuditAction,
  type Question,
  type QuestionInput,
  type RubricCriterion,
  type RubricInput,
} from '@lead/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  assessmentObjectives,
  assessmentQuestions,
  assessments,
  attempts,
  classSections,
  courses,
  enrollments,
  learningObjectives,
  questionChoices,
  rubricCriteria,
  rubricLevels,
  submissions,
  teachingAssignments,
  type AssessmentRow,
  type QuestionRow,
  type UserRow,
} from '../database/schema';
import { publicationChecklist, questionPoints, rubricPoints } from './assessment-checklist';

/** Who is changing an assessment, for the audit trail. */
export interface AssessmentEditor {
  readonly teacher: UserRow;
  readonly client: ClientInfo;
}

interface ClassContext {
  readonly sectionId: string;
  readonly sectionName: string;
  readonly courseId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly archived: boolean;
}

const objectiveCode = (number: number): string => `O${number}`;
const NOT_YOURS = 'No such assessment among your classes this term.';

/**
 * Assessments (wireframes T08–T12). Only teachers of the class this term see or change them.
 * Every change locks the assessment row first, so question positions and the publishing checks
 * are computed by one request at a time. Drafts are edited; published ones only unpublished.
 */
@Injectable()
export class AssessmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reading

  /** T08: the teacher's classes this term and their assessments, optionally one class only. */
  async list(teacher: UserRow, sectionId?: string): Promise<AssessmentList> {
    const classRows = await this.classes(this.db, teacher);
    const classes: AssessmentClass[] = classRows
      .filter((row) => !row.archived)
      .map((row) => ({
        id: row.sectionId,
        name: row.sectionName,
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
      }));
    const sectionIds = classRows
      .map((row) => row.sectionId)
      .filter((id) => sectionId === undefined || id === sectionId);
    if (sectionIds.length === 0) return { classes, items: [] };

    const rows = await this.db
      .select()
      .from(assessments)
      .where(inArray(assessments.sectionId, sectionIds))
      .orderBy(
        asc(sql`${assessments.dueAt} is null`),
        asc(assessments.dueAt),
        desc(assessments.createdAt),
      );
    const byId = new Map(classRows.map((row) => [row.sectionId, row]));
    const [codes, points] = await Promise.all([
      this.objectiveCodes(
        this.db,
        rows.map((row) => row.id),
      ),
      this.points(this.db, rows),
    ]);
    const items = rows.map((row) =>
      toSummary(row, byId.get(row.sectionId)!, codes.get(row.id) ?? [], points.get(row.id) ?? 0),
    );
    return { classes, items };
  }

  async details(teacher: UserRow, assessmentId: string): Promise<AssessmentDetails> {
    const { assessment, context } = await this.find(this.db, teacher, assessmentId);
    return this.describe(this.db, assessment, context);
  }

  // ---------- Changing

  async create(input: AssessmentCreate, editor: AssessmentEditor): Promise<AssessmentDetails> {
    return this.db.transaction(async (tx) => {
      // Section first, as the administrator's changes to a section's teachers lock it, then the
      // assignment: the other order deadlocks with them (the insert key-share-locks the section).
      await tx
        .select({ id: classSections.id })
        .from(classSections)
        .where(eq(classSections.id, input.sectionId))
        .for('share');
      const context = await this.classOf(tx, editor.teacher, input.sectionId, true);
      if (!context) throw new NotFoundException('No such class among your classes this term.');
      if (context.archived) throw new ConflictException(`${context.courseCode} is archived.`);
      const [created] = await tx
        .insert(assessments)
        .values({
          sectionId: input.sectionId,
          kind: input.kind,
          title: input.title,
          createdBy: editor.teacher.id,
        })
        .returning();
      if (!created) throw new ConflictException('The assessment could not be created.');
      await this.record(tx, editor, 'assessment.created', 'assessment', created.id, null, {
        kind: created.kind,
        title: created.title,
        sectionId: created.sectionId,
      });
      return this.describe(tx, created, context);
    });
  }

  async updateSettings(
    assessmentId: string,
    input: AssessmentSettings,
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment, context) => {
      if (input.timeLimitMinutes && !usesQuestions(assessment.kind)) {
        throw new BadRequestException('Only quizzes and examinations have a time limit.');
      }
      if (input.acceptLate && usesQuestions(assessment.kind)) {
        throw new BadRequestException('Only assignments and projects accept late work.');
      }
      const opensAt = input.opensAt === undefined ? assessment.opensAt : toDate(input.opensAt);
      const dueAt = input.dueAt === undefined ? assessment.dueAt : toDate(input.dueAt);
      if (opensAt && dueAt && dueAt <= opensAt) {
        throw new BadRequestException('The due date must be after the opening date.');
      }

      const beforeObjectives = await this.objectiveIds(tx, assessment.id);
      if (input.objectiveIds) {
        await this.checkObjectives(tx, context.courseId, input.objectiveIds);
        await this.checkQuestionsStillMapped(tx, assessment.id, input.objectiveIds);
      }

      const next = {
        title: input.title ?? assessment.title,
        instructions: input.instructions ?? assessment.instructions,
        opensAt,
        dueAt,
        timeLimitMinutes:
          input.timeLimitMinutes === undefined
            ? assessment.timeLimitMinutes
            : input.timeLimitMinutes,
        maxAttempts: input.maxAttempts ?? assessment.maxAttempts,
        acceptLate: input.acceptLate ?? assessment.acceptLate,
      };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        if (!sameValue(assessment[key], next[key])) {
          before[key] = auditValue(assessment[key]);
          after[key] = auditValue(next[key]);
        }
      }
      if (input.objectiveIds && !sameSet(beforeObjectives, input.objectiveIds)) {
        await tx
          .delete(assessmentObjectives)
          .where(eq(assessmentObjectives.assessmentId, assessment.id));
        if (input.objectiveIds.length > 0) {
          await tx.insert(assessmentObjectives).values(
            input.objectiveIds.map((objectiveId) => ({
              assessmentId: assessment.id,
              objectiveId,
            })),
          );
        }
        before.objectiveIds = beforeObjectives;
        after.objectiveIds = input.objectiveIds;
      }
      if (Object.keys(after).length === 0) return;
      await tx
        .update(assessments)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));
      await this.record(
        tx,
        editor,
        'assessment.updated',
        'assessment',
        assessment.id,
        before,
        after,
      );
    });
  }

  async addQuestion(
    assessmentId: string,
    input: QuestionInput,
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment) => {
      this.requireQuestions(assessment);
      await this.checkQuestionObjective(tx, assessment.id, input.objectiveId);
      const [{ total } = { total: 0 }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(assessmentQuestions)
        .where(eq(assessmentQuestions.assessmentId, assessment.id));
      if (total >= 100) throw new ConflictException('An assessment has at most 100 questions.');
      const [created] = await tx
        .insert(assessmentQuestions)
        .values({
          assessmentId: assessment.id,
          position: total + 1,
          kind: input.kind,
          prompt: input.prompt,
          points: input.points,
          difficulty: input.difficulty,
          objectiveId: input.objectiveId,
        })
        .returning();
      if (!created) throw new ConflictException('The question could not be added.');
      await this.setChoices(tx, created.id, input);
      await this.record(tx, editor, 'question.created', 'question', created.id, null, {
        assessmentId: assessment.id,
        ...questionAudit(input),
      });
    });
  }

  async updateQuestion(
    assessmentId: string,
    questionId: string,
    input: QuestionInput,
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment) => {
      this.requireQuestions(assessment);
      const question = await this.findQuestion(tx, assessment.id, questionId);
      await this.checkQuestionObjective(tx, assessment.id, input.objectiveId);
      const before = questionAudit({
        ...question,
        choices: (await this.choices(tx, [question.id])).get(question.id) ?? [],
      });
      const after = questionAudit(input);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      await tx
        .update(assessmentQuestions)
        .set({
          kind: input.kind,
          prompt: input.prompt,
          points: input.points,
          difficulty: input.difficulty,
          objectiveId: input.objectiveId,
          updatedAt: new Date(),
        })
        .where(eq(assessmentQuestions.id, question.id));
      await this.setChoices(tx, question.id, input);
      await this.record(tx, editor, 'question.updated', 'question', question.id, before, after);
    });
  }

  async moveQuestion(
    assessmentId: string,
    questionId: string,
    direction: 'up' | 'down',
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment) => {
      this.requireQuestions(assessment);
      const question = await this.findQuestion(tx, assessment.id, questionId);
      const target = question.position + (direction === 'up' ? -1 : 1);
      const [neighbour] = await tx
        .select()
        .from(assessmentQuestions)
        .where(
          and(
            eq(assessmentQuestions.assessmentId, assessment.id),
            eq(assessmentQuestions.position, target),
          ),
        );
      if (!neighbour) return;
      await tx
        .update(assessmentQuestions)
        .set({ position: question.position })
        .where(eq(assessmentQuestions.id, neighbour.id));
      await tx
        .update(assessmentQuestions)
        .set({ position: target })
        .where(eq(assessmentQuestions.id, question.id));
      await this.record(
        tx,
        editor,
        'question.moved',
        'question',
        question.id,
        { position: question.position },
        { position: target },
      );
    });
  }

  async removeQuestion(
    assessmentId: string,
    questionId: string,
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment) => {
      this.requireQuestions(assessment);
      const question = await this.findQuestion(tx, assessment.id, questionId);
      const removed = questionAudit({
        ...question,
        choices: (await this.choices(tx, [question.id])).get(question.id) ?? [],
      });
      await tx.delete(assessmentQuestions).where(eq(assessmentQuestions.id, question.id));
      await tx
        .update(assessmentQuestions)
        .set({ position: sql`${assessmentQuestions.position} - 1` })
        .where(
          and(
            eq(assessmentQuestions.assessmentId, assessment.id),
            sql`${assessmentQuestions.position} > ${question.position}`,
          ),
        );
      await this.record(
        tx,
        editor,
        'question.removed',
        'question',
        question.id,
        { position: question.position, ...removed },
        null,
      );
    });
  }

  async saveRubric(
    assessmentId: string,
    input: RubricInput,
    editor: AssessmentEditor,
  ): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment) => {
      if (usesQuestions(assessment.kind)) {
        throw new ConflictException('Quizzes and examinations are scored by their questions.');
      }
      const before = await this.rubric(tx, assessment.id);
      const after = input.criteria;
      if (JSON.stringify(rubricAudit(before)) === JSON.stringify(rubricAudit(after))) return;
      await tx.delete(rubricCriteria).where(eq(rubricCriteria.assessmentId, assessment.id));
      for (const [index, criterion] of input.criteria.entries()) {
        const [created] = await tx
          .insert(rubricCriteria)
          .values({ assessmentId: assessment.id, position: index + 1, name: criterion.name })
          .returning({ id: rubricCriteria.id });
        if (!created) throw new ConflictException('The rubric could not be saved.');
        await tx.insert(rubricLevels).values(
          criterion.levels.map((level, position) => ({
            criterionId: created.id,
            position: position + 1,
            label: level.label,
            points: level.points,
            descriptor: level.descriptor,
          })),
        );
      }
      await this.record(
        tx,
        editor,
        'rubric.saved',
        'assessment',
        assessment.id,
        {
          criteria: rubricAudit(before),
        },
        { criteria: rubricAudit(after) },
      );
    });
  }

  /** T12: publishes only when every check passes; otherwise names the first that fails. */
  async publish(assessmentId: string, editor: AssessmentEditor): Promise<AssessmentDetails> {
    return this.change(assessmentId, editor, async (tx, assessment, context) => {
      const details = await this.describe(tx, assessment, context);
      const failed = details.checklist.find((item) => !item.ok);
      if (failed) throw new ConflictException(failed.detail);
      const publishedAt = new Date();
      await tx
        .update(assessments)
        .set({ status: 'published', publishedAt, updatedAt: publishedAt })
        .where(eq(assessments.id, assessment.id));
      await this.record(
        tx,
        editor,
        'assessment.published',
        'assessment',
        assessment.id,
        {
          status: 'draft',
        },
        {
          status: 'published',
          opensAt: assessment.opensAt?.toISOString(),
          dueAt: assessment.dueAt?.toISOString(),
        },
      );
    });
  }

  async unpublish(assessmentId: string, editor: AssessmentEditor): Promise<AssessmentDetails> {
    return this.change(
      assessmentId,
      editor,
      async (tx, assessment) => {
        if (assessment.status === 'draft') return;
        // Attempts start while sharing this row's lock, so none can begin meanwhile.
        const [[started], [handedIn]] = await Promise.all([
          tx
            .select({ id: attempts.id })
            .from(attempts)
            .where(eq(attempts.assessmentId, assessment.id))
            .limit(1),
          tx
            .select({ id: submissions.id })
            .from(submissions)
            .where(
              and(eq(submissions.assessmentId, assessment.id), eq(submissions.status, 'submitted')),
            )
            .limit(1),
        ]);
        if (started || handedIn) {
          throw new ConflictException(
            'Students have already started this assessment, so it cannot be unpublished.',
          );
        }
        await tx
          .update(assessments)
          .set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
          .where(eq(assessments.id, assessment.id));
        await this.record(
          tx,
          editor,
          'assessment.unpublished',
          'assessment',
          assessment.id,
          { status: 'published' },
          { status: 'draft' },
        );
      },
      { allowPublished: true },
    );
  }

  // ---------- Helpers

  /**
   * Runs a change holding the assessment row lock, after checking the editor still teaches the
   * class this term (their assignment row is share-locked, so it cannot be removed meanwhile).
   * Published assessments refuse changes other than unpublishing.
   */
  private async change(
    assessmentId: string,
    editor: AssessmentEditor,
    work: (tx: DbExecutor, assessment: AssessmentRow, context: ClassContext) => Promise<void>,
    { allowPublished = false } = {},
  ): Promise<AssessmentDetails> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(assessments)
        .where(eq(assessments.id, assessmentId))
        .for('update');
      const context = locked && (await this.classOf(tx, editor.teacher, locked.sectionId, true));
      if (!locked || !context) throw new NotFoundException(NOT_YOURS);
      if (context.archived) throw new ConflictException(`${context.courseCode} is archived.`);
      if (!allowPublished && locked.status === 'published') {
        throw new ConflictException('Unpublish the assessment before changing it.');
      }
      await work(tx, locked, context);
      const [fresh] = await tx.select().from(assessments).where(eq(assessments.id, assessmentId));
      return this.describe(tx, fresh ?? locked, context);
    });
  }

  private async find(
    executor: DbExecutor,
    teacher: UserRow,
    assessmentId: string,
  ): Promise<{ assessment: AssessmentRow; context: ClassContext }> {
    const [assessment] = await executor
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId));
    const context = assessment && (await this.classOf(executor, teacher, assessment.sectionId));
    // Same answer for "not yours" and "does not exist", so ids cannot be probed.
    if (!assessment || !context) throw new NotFoundException(NOT_YOURS);
    return { assessment, context };
  }

  /** The teacher's current-term classes. */
  private classes(executor: DbExecutor, teacher: UserRow): Promise<ClassContext[]> {
    return this.classQuery(executor, teacher).orderBy(asc(courses.code), asc(classSections.name));
  }

  private async classOf(
    executor: DbExecutor,
    teacher: UserRow,
    sectionId: string,
    lock = false,
  ): Promise<ClassContext | undefined> {
    const query = this.classQuery(executor, teacher, sectionId).limit(1);
    // The course is share-locked too, so it cannot be archived while the change is made.
    const [row] = lock
      ? await query.for('share', { of: [teachingAssignments, courses] })
      : await query;
    return row;
  }

  private classQuery(executor: DbExecutor, teacher: UserRow, sectionId?: string) {
    return executor
      .select({
        sectionId: classSections.id,
        sectionName: classSections.name,
        courseId: courses.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        archived: sql<boolean>`${courses.archivedAt} is not null`,
      })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(
        and(
          eq(teachingAssignments.teacherId, teacher.id),
          eq(academicTerms.current, true),
          sectionId === undefined ? undefined : eq(classSections.id, sectionId),
        ),
      )
      .$dynamic();
  }

  private async describe(
    executor: DbExecutor,
    assessment: AssessmentRow,
    context: ClassContext,
  ): Promise<AssessmentDetails> {
    const [objectiveRows, objectiveIds, questions, rubric, [enrolled]] = await Promise.all([
      executor
        .select()
        .from(learningObjectives)
        .where(eq(learningObjectives.courseId, context.courseId))
        .orderBy(asc(learningObjectives.number)),
      this.objectiveIds(executor, assessment.id),
      this.questions(executor, assessment.id),
      this.rubric(executor, assessment.id),
      executor
        .select({ total: sql<number>`count(*)::int` })
        .from(enrollments)
        .where(
          and(eq(enrollments.sectionId, assessment.sectionId), eq(enrollments.status, 'enrolled')),
        ),
    ]);
    const courseObjectives = objectiveRows.map((row) => ({
      id: row.id,
      code: objectiveCode(row.number),
      description: row.description,
    }));
    const objectiveCodes = courseObjectives
      .filter((objective) => objectiveIds.includes(objective.id))
      .map((objective) => objective.code);
    const points = usesQuestions(assessment.kind)
      ? questionPoints(questions)
      : rubricPoints(rubric);
    return {
      ...toSummary(assessment, context, objectiveCodes, points),
      instructions: assessment.instructions,
      timeLimitMinutes: assessment.timeLimitMinutes,
      maxAttempts: assessment.maxAttempts,
      acceptLate: assessment.acceptLate,
      objectiveIds: courseObjectives
        .filter((objective) => objectiveIds.includes(objective.id))
        .map((objective) => objective.id),
      publishedAt: assessment.publishedAt?.toISOString() ?? null,
      updatedAt: assessment.updatedAt.toISOString(),
      enrolled: enrolled?.total ?? 0,
      courseObjectives,
      questions,
      rubric,
      checklist: publicationChecklist(
        {
          kind: assessment.kind,
          objectiveCodes,
          opensAt: assessment.opensAt,
          dueAt: assessment.dueAt,
          timeLimitMinutes: assessment.timeLimitMinutes,
          maxAttempts: assessment.maxAttempts,
          acceptLate: assessment.acceptLate,
          questions,
          rubric,
        },
        new Date(),
      ),
    };
  }

  private async questions(executor: DbExecutor, assessmentId: string): Promise<Question[]> {
    const rows = await executor
      .select()
      .from(assessmentQuestions)
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.position));
    const choices = await this.choices(
      executor,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      position: row.position,
      kind: row.kind,
      prompt: row.prompt,
      points: row.points,
      difficulty: row.difficulty,
      objectiveId: row.objectiveId,
      choices: choices.get(row.id) ?? [],
    }));
  }

  private async choices(
    executor: DbExecutor,
    questionIds: readonly string[],
  ): Promise<Map<string, { id: string; text: string; correct: boolean }[]>> {
    const byQuestion = new Map<string, { id: string; text: string; correct: boolean }[]>();
    if (questionIds.length === 0) return byQuestion;
    const rows = await executor
      .select()
      .from(questionChoices)
      .where(inArray(questionChoices.questionId, [...questionIds]))
      .orderBy(asc(questionChoices.position));
    for (const row of rows) {
      byQuestion.set(row.questionId, [
        ...(byQuestion.get(row.questionId) ?? []),
        { id: row.id, text: row.text, correct: row.correct },
      ]);
    }
    return byQuestion;
  }

  private async rubric(executor: DbExecutor, assessmentId: string): Promise<RubricCriterion[]> {
    const rows = await executor
      .select({ criterion: rubricCriteria, level: rubricLevels })
      .from(rubricCriteria)
      .innerJoin(rubricLevels, eq(rubricLevels.criterionId, rubricCriteria.id))
      .where(eq(rubricCriteria.assessmentId, assessmentId))
      .orderBy(asc(rubricCriteria.position), asc(rubricLevels.position));
    const byCriterion = new Map<string, RubricCriterion>();
    for (const { criterion, level } of rows) {
      const existing = byCriterion.get(criterion.id);
      byCriterion.set(criterion.id, {
        id: criterion.id,
        name: criterion.name,
        levels: [
          ...(existing?.levels ?? []),
          { id: level.id, label: level.label, points: level.points, descriptor: level.descriptor },
        ],
      });
    }
    return [...byCriterion.values()];
  }

  private async objectiveIds(executor: DbExecutor, assessmentId: string): Promise<string[]> {
    const rows = await executor
      .select({ id: assessmentObjectives.objectiveId })
      .from(assessmentObjectives)
      .where(eq(assessmentObjectives.assessmentId, assessmentId));
    return rows.map((row) => row.id);
  }

  private async objectiveCodes(
    executor: DbExecutor,
    assessmentIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const codes = new Map<string, string[]>();
    if (assessmentIds.length === 0) return codes;
    const rows = await executor
      .select({
        assessmentId: assessmentObjectives.assessmentId,
        number: learningObjectives.number,
      })
      .from(assessmentObjectives)
      .innerJoin(learningObjectives, eq(learningObjectives.id, assessmentObjectives.objectiveId))
      .where(inArray(assessmentObjectives.assessmentId, [...assessmentIds]))
      .orderBy(asc(learningObjectives.number));
    for (const row of rows) {
      codes.set(row.assessmentId, [
        ...(codes.get(row.assessmentId) ?? []),
        objectiveCode(row.number),
      ]);
    }
    return codes;
  }

  /** Total points per assessment: question points, or the best level of every criterion. */
  private async points(
    executor: DbExecutor,
    rows: readonly AssessmentRow[],
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return totals;
    const [questionTotals, criterionBests] = await Promise.all([
      executor
        .select({
          assessmentId: assessmentQuestions.assessmentId,
          total: sql<number>`sum(${assessmentQuestions.points})::int`,
        })
        .from(assessmentQuestions)
        .where(inArray(assessmentQuestions.assessmentId, ids))
        .groupBy(assessmentQuestions.assessmentId),
      executor
        .select({
          assessmentId: rubricCriteria.assessmentId,
          best: sql<number>`max(${rubricLevels.points})::int`,
        })
        .from(rubricCriteria)
        .innerJoin(rubricLevels, eq(rubricLevels.criterionId, rubricCriteria.id))
        .where(inArray(rubricCriteria.assessmentId, ids))
        .groupBy(rubricCriteria.assessmentId, rubricCriteria.id),
    ]);
    const kinds = new Map(rows.map((row) => [row.id, row.kind]));
    for (const row of questionTotals) {
      if (usesQuestions(kinds.get(row.assessmentId)!)) totals.set(row.assessmentId, row.total);
    }
    for (const row of criterionBests) {
      if (!usesQuestions(kinds.get(row.assessmentId)!)) {
        totals.set(row.assessmentId, (totals.get(row.assessmentId) ?? 0) + row.best);
      }
    }
    return totals;
  }

  private async findQuestion(
    executor: DbExecutor,
    assessmentId: string,
    questionId: string,
  ): Promise<QuestionRow> {
    const [question] = await executor
      .select()
      .from(assessmentQuestions)
      .where(
        and(
          eq(assessmentQuestions.id, questionId),
          eq(assessmentQuestions.assessmentId, assessmentId),
        ),
      );
    if (!question) throw new NotFoundException('No such question in this assessment.');
    return question;
  }

  private async setChoices(
    executor: DbExecutor,
    questionId: string,
    input: QuestionInput,
  ): Promise<void> {
    await executor.delete(questionChoices).where(eq(questionChoices.questionId, questionId));
    if (input.choices.length === 0) return;
    await executor.insert(questionChoices).values(
      input.choices.map((choice, index) => ({
        questionId,
        position: index + 1,
        text: choice.text,
        correct: choice.correct,
      })),
    );
  }

  private requireQuestions(assessment: AssessmentRow): void {
    if (!usesQuestions(assessment.kind)) {
      throw new ConflictException('Assignments and projects are scored with a rubric.');
    }
  }

  /** Every id must be an objective of this course. */
  private async checkObjectives(
    executor: DbExecutor,
    courseId: string,
    objectiveIds: readonly string[],
  ): Promise<void> {
    if (objectiveIds.length === 0) return;
    const found = await executor
      .select({ id: learningObjectives.id })
      .from(learningObjectives)
      .where(
        and(
          eq(learningObjectives.courseId, courseId),
          inArray(learningObjectives.id, [...objectiveIds]),
        ),
      );
    if (found.length !== objectiveIds.length) {
      throw new ConflictException('Choose objectives of this course only.');
    }
  }

  /** No question may lose the objective it is mapped to. */
  private async checkQuestionsStillMapped(
    executor: DbExecutor,
    assessmentId: string,
    next: readonly string[],
  ): Promise<void> {
    const used = await executor
      .select({
        position: assessmentQuestions.position,
        objectiveId: assessmentQuestions.objectiveId,
        number: learningObjectives.number,
      })
      .from(assessmentQuestions)
      .innerJoin(learningObjectives, eq(learningObjectives.id, assessmentQuestions.objectiveId))
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.position));
    const orphaned = used.find((row) => row.objectiveId && !next.includes(row.objectiveId));
    if (orphaned) {
      throw new ConflictException(
        `Question ${orphaned.position} measures ${objectiveCode(orphaned.number)}. Change that question first.`,
      );
    }
  }

  private async checkQuestionObjective(
    executor: DbExecutor,
    assessmentId: string,
    objectiveId: string | null,
  ): Promise<void> {
    if (objectiveId === null) return;
    if (!(await this.objectiveIds(executor, assessmentId)).includes(objectiveId)) {
      throw new ConflictException("Choose one of this assessment's learning objectives.");
    }
  }

  private async record(
    tx: DbExecutor,
    editor: AssessmentEditor,
    action: AuditAction,
    targetType: 'assessment' | 'question',
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: editor.teacher.id,
        actorRole: editor.teacher.role,
        action,
        targetType,
        targetId,
        outcome: 'success',
        reason: null,
        before,
        after,
        ipAddress: editor.client.ipAddress,
        userAgent: editor.client.userAgent,
      },
      tx,
    );
  }
}

function toSummary(
  row: AssessmentRow,
  context: ClassContext,
  objectiveCodes: readonly string[],
  points: number,
): AssessmentSummary {
  return {
    id: row.id,
    sectionId: row.sectionId,
    sectionName: context.sectionName,
    courseId: context.courseId,
    courseCode: context.courseCode,
    courseTitle: context.courseTitle,
    kind: row.kind,
    title: row.title,
    status: row.status,
    opensAt: row.opensAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    objectiveCodes,
    points,
  };
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function auditValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a as Date | null)?.getTime() === (b as Date | null)?.getTime();
  }
  return a === b;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function questionAudit(
  question: Pick<QuestionInput, 'kind' | 'prompt' | 'points' | 'difficulty' | 'objectiveId'> & {
    readonly choices: readonly { text: string; correct: boolean }[];
  },
): Record<string, unknown> {
  return {
    kind: question.kind,
    prompt: question.prompt,
    points: question.points,
    difficulty: question.difficulty,
    objectiveId: question.objectiveId,
    choices: question.choices.map((choice) => ({ text: choice.text, correct: choice.correct })),
  };
}

function rubricAudit(
  criteria: readonly {
    name: string;
    levels: readonly { label: string; points: number; descriptor: string }[];
  }[],
): unknown[] {
  return criteria.map((criterion) => ({
    name: criterion.name,
    levels: criterion.levels.map((level) => ({
      label: level.label,
      points: level.points,
      descriptor: level.descriptor,
    })),
  }));
}
