import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  AuditAction,
  ContentStatus,
  CourseContent,
  Lesson,
  LessonInput,
  LessonUpdate,
  ModuleInput,
  ModuleUpdate,
  MoveRequest,
  ObjectiveInput,
  TeacherCourse,
} from '@lead/schema';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  classSections,
  courseModules,
  courses,
  learningObjectives,
  lessons,
  moduleObjectives,
  teachingAssignments,
  type CourseRow,
  type LessonRow,
  type ModuleRow,
  type UserRow,
} from '../database/schema';

/** Who is changing content, for the audit trail. */
export interface ContentEditor {
  readonly teacher: UserRow;
  readonly client: ClientInfo;
}

const objectiveCode = (number: number): string => `O${number}`;

/**
 * Course content (wireframes T04–T06). Only teachers of a current-term section of the course may
 * see or change it. Every change locks the course row first, so positions, objective numbers and
 * the publishing checks are always computed by one request at a time.
 */
@Injectable()
export class ContentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reading

  /** Courses the teacher teaches this term, with the sections they run. */
  async courses(teacher: UserRow): Promise<TeacherCourse[]> {
    const rows = await this.db
      .select({
        id: courses.id,
        code: courses.code,
        title: courses.title,
        section: classSections.name,
      })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(
        and(
          eq(teachingAssignments.teacherId, teacher.id),
          eq(academicTerms.current, true),
          isNull(courses.archivedAt),
        ),
      )
      .orderBy(asc(courses.code), asc(classSections.name));
    const byCourse = new Map<string, TeacherCourse>();
    for (const row of rows) {
      const existing = byCourse.get(row.id);
      byCourse.set(row.id, {
        id: row.id,
        code: row.code,
        title: row.title,
        sections: [...(existing?.sections ?? []), row.section],
      });
    }
    return [...byCourse.values()];
  }

  async content(teacher: UserRow, courseId: string): Promise<CourseContent> {
    const course = await this.teachableCourse(this.db, teacher, courseId);
    return this.outline(this.db, course);
  }

  async lesson(teacher: UserRow, courseId: string, lessonId: string): Promise<Lesson> {
    await this.teachableCourse(this.db, teacher, courseId);
    return toLesson(await this.findLesson(this.db, courseId, lessonId));
  }

  // ---------- Objectives

  async createObjective(
    courseId: string,
    input: ObjectiveInput,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx, course) => {
      const [last] = await tx
        .select({ number: max(learningObjectives.number) })
        .from(learningObjectives)
        .where(eq(learningObjectives.courseId, course.id));
      const [created] = await tx
        .insert(learningObjectives)
        .values({ courseId, number: (last?.number ?? 0) + 1, description: input.description })
        .returning();
      if (!created) throw new ConflictException('The objective could not be added.');
      await this.record(tx, editor, 'objective.created', 'objective', created.id, null, {
        code: objectiveCode(created.number),
        description: created.description,
      });
    });
  }

  async updateObjective(
    courseId: string,
    objectiveId: string,
    input: ObjectiveInput,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx) => {
      const [objective] = await tx
        .select()
        .from(learningObjectives)
        .where(
          and(eq(learningObjectives.id, objectiveId), eq(learningObjectives.courseId, courseId)),
        );
      if (!objective) throw new NotFoundException('No such objective in this course.');
      if (objective.description === input.description) return;
      await tx
        .update(learningObjectives)
        .set({ description: input.description, updatedAt: new Date() })
        .where(eq(learningObjectives.id, objectiveId));
      await this.record(
        tx,
        editor,
        'objective.updated',
        'objective',
        objectiveId,
        { description: objective.description },
        { description: input.description },
      );
    });
  }

  // ---------- Modules

  async createModule(
    courseId: string,
    input: ModuleInput,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx) => {
      await this.checkObjectives(tx, courseId, input.objectiveIds);
      const [last] = await tx
        .select({ position: max(courseModules.position) })
        .from(courseModules)
        .where(eq(courseModules.courseId, courseId));
      const [created] = await tx
        .insert(courseModules)
        .values({
          courseId,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          description: input.description,
          requiresPrevious: input.requiresPrevious,
          masteryThreshold: input.masteryThreshold,
        })
        .returning();
      if (!created) throw new ConflictException('The module could not be added.');
      await this.setModuleObjectives(tx, created.id, input.objectiveIds);
      await this.record(tx, editor, 'module.created', 'module', created.id, null, {
        title: created.title,
        position: created.position,
        objectiveIds: input.objectiveIds,
      });
    });
  }

  async updateModule(
    courseId: string,
    moduleId: string,
    update: ModuleUpdate,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx) => {
      const module = await this.findModule(tx, courseId, moduleId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const fields: Partial<ModuleRow> = {};
      for (const key of ['title', 'description', 'requiresPrevious', 'masteryThreshold'] as const) {
        if (update[key] !== undefined && update[key] !== module[key]) {
          before[key] = module[key];
          after[key] = update[key];
          Object.assign(fields, { [key]: update[key] });
        }
      }

      if (update.objectiveIds) {
        const current = await this.moduleObjectiveIds(tx, moduleId);
        const next = [...new Set(update.objectiveIds)];
        if (!sameSet(current, next)) {
          await this.checkObjectives(tx, courseId, next);
          await this.checkObjectivesStillCover(tx, module, next);
          await this.setModuleObjectives(tx, moduleId, next);
          before.objectiveIds = current;
          after.objectiveIds = next;
        }
      }
      if (Object.keys(after).length === 0) return;

      await tx
        .update(courseModules)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(courseModules.id, moduleId));
      await this.record(tx, editor, 'module.updated', 'module', moduleId, before, after);
    });
  }

  /** Swaps a module with its neighbour above or below. */
  async moveModule(
    courseId: string,
    moduleId: string,
    move: MoveRequest,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx) => {
      const module = await this.findModule(tx, courseId, moduleId);
      const [neighbour] = await tx
        .select()
        .from(courseModules)
        .where(
          and(
            eq(courseModules.courseId, courseId),
            move.direction === 'up'
              ? sql`${courseModules.position} < ${module.position}`
              : sql`${courseModules.position} > ${module.position}`,
          ),
        )
        .orderBy(
          move.direction === 'up' ? desc(courseModules.position) : asc(courseModules.position),
        )
        .limit(1);
      if (!neighbour) {
        throw new ConflictException(
          `${module.title} is already the ${move.direction === 'up' ? 'first' : 'last'} module.`,
        );
      }
      await tx
        .update(courseModules)
        .set({ position: neighbour.position })
        .where(eq(courseModules.id, module.id));
      await tx
        .update(courseModules)
        .set({ position: module.position })
        .where(eq(courseModules.id, neighbour.id));
      await this.record(
        tx,
        editor,
        'module.moved',
        'module',
        moduleId,
        { position: module.position },
        { position: neighbour.position },
      );
    });
  }

  async setModuleStatus(
    courseId: string,
    moduleId: string,
    status: ContentStatus,
    editor: ContentEditor,
  ): Promise<CourseContent> {
    return this.change(courseId, editor, async (tx) => {
      const module = await this.findModule(tx, courseId, moduleId);
      if (module.status === status) return;
      if (status === 'published' && (await this.moduleObjectiveIds(tx, moduleId)).length === 0) {
        throw new ConflictException(
          'Map at least one learning objective to this module before publishing it.',
        );
      }
      await tx
        .update(courseModules)
        .set({
          status,
          publishedAt: status === 'published' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(courseModules.id, moduleId));
      await this.record(
        tx,
        editor,
        status === 'published' ? 'module.published' : 'module.unpublished',
        'module',
        moduleId,
        { status: module.status },
        { status },
      );
    });
  }

  // ---------- Lessons

  async createLesson(
    courseId: string,
    moduleId: string,
    input: LessonInput,
    editor: ContentEditor,
  ): Promise<Lesson> {
    return this.inCourse(courseId, editor, async (tx) => {
      await this.findModule(tx, courseId, moduleId);
      await this.checkLessonObjective(tx, moduleId, input.objectiveId);
      const [last] = await tx
        .select({ position: max(lessons.position) })
        .from(lessons)
        .where(eq(lessons.moduleId, moduleId));
      const [created] = await tx
        .insert(lessons)
        .values({
          moduleId,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          objectiveId: input.objectiveId,
          body: input.body,
        })
        .returning();
      if (!created) throw new ConflictException('The lesson could not be added.');
      await this.record(tx, editor, 'lesson.created', 'lesson', created.id, null, {
        moduleId,
        title: created.title,
        objectiveId: created.objectiveId,
        body: bodyFingerprint(created.body),
      });
      return toLesson(created);
    });
  }

  async updateLesson(
    courseId: string,
    lessonId: string,
    update: LessonUpdate,
    editor: ContentEditor,
  ): Promise<Lesson> {
    return this.inCourse(courseId, editor, async (tx) => {
      const lesson = await this.findLesson(tx, courseId, lessonId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of ['title', 'objectiveId', 'body'] as const) {
        if (update[key] !== undefined && update[key] !== lesson[key]) {
          // Lesson text can be long: the audit keeps its length and SHA-256, which prove what
          // students were shown without copying the whole text into every event.
          before[key] = key === 'body' ? bodyFingerprint(lesson.body) : lesson[key];
          after[key] = key === 'body' ? bodyFingerprint(update.body ?? '') : update[key];
        }
      }
      if (Object.keys(after).length === 0) return toLesson(lesson);

      if (update.objectiveId !== undefined) {
        await this.checkLessonObjective(tx, lesson.moduleId, update.objectiveId);
      }
      const next = { ...lesson, ...update };
      if (lesson.status === 'published') this.checkPublishable(next);

      await tx
        .update(lessons)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(lessons.id, lessonId));
      await this.record(tx, editor, 'lesson.updated', 'lesson', lessonId, before, after);
      return toLesson(await this.findLesson(tx, courseId, lessonId));
    });
  }

  async setLessonStatus(
    courseId: string,
    lessonId: string,
    status: ContentStatus,
    editor: ContentEditor,
  ): Promise<Lesson> {
    return this.inCourse(courseId, editor, async (tx) => {
      const lesson = await this.findLesson(tx, courseId, lessonId);
      if (lesson.status === status) return toLesson(lesson);
      if (status === 'published') this.checkPublishable(lesson);
      await tx
        .update(lessons)
        .set({
          status,
          publishedAt: status === 'published' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(lessons.id, lessonId));
      await this.record(
        tx,
        editor,
        status === 'published' ? 'lesson.published' : 'lesson.unpublished',
        'lesson',
        lessonId,
        { status: lesson.status },
        { status },
      );
      return toLesson(await this.findLesson(tx, courseId, lessonId));
    });
  }

  // ---------- Helpers

  /** A change that answers with the updated outline. */
  private async change(
    courseId: string,
    editor: ContentEditor,
    work: (tx: DbExecutor, course: CourseRow) => Promise<void>,
  ): Promise<CourseContent> {
    return this.inCourse(courseId, editor, async (tx, course) => {
      await work(tx, course);
      return this.outline(tx, course);
    });
  }

  /**
   * Runs a change in a transaction holding the course row lock, after checking the editor still
   * teaches the course (their assignment row is share-locked, so it cannot be removed meanwhile).
   * Archived courses stay readable to their teachers but cannot be changed.
   */
  private async inCourse<T>(
    courseId: string,
    editor: ContentEditor,
    work: (tx: DbExecutor, course: CourseRow) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.teachableCourse(tx, editor.teacher, courseId, true);
      const [course] = await tx
        .select()
        .from(courses)
        .where(eq(courses.id, courseId))
        .for('update');
      if (!course) throw new NotFoundException('No such course.');
      if (course.archivedAt) throw new ConflictException(`${course.code} is archived.`);
      return work(tx, course);
    });
  }

  /** The course, if the teacher teaches one of its sections this term; 404 otherwise. */
  private async teachableCourse(
    executor: DbExecutor,
    teacher: UserRow,
    courseId: string,
    lock = false,
  ): Promise<CourseRow> {
    const query = executor
      .select({ course: courses })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(
        and(
          eq(teachingAssignments.teacherId, teacher.id),
          eq(classSections.courseId, courseId),
          eq(academicTerms.current, true),
        ),
      )
      .limit(1);
    const [row] = lock ? await query.for('share', { of: teachingAssignments }) : await query;
    // Same answer for "not yours" and "does not exist", so course ids cannot be probed.
    if (!row) throw new NotFoundException('No such course among your classes this term.');
    return row.course;
  }

  private async outline(executor: DbExecutor, course: CourseRow): Promise<CourseContent> {
    const [objectiveRows, moduleRows] = await Promise.all([
      executor
        .select()
        .from(learningObjectives)
        .where(eq(learningObjectives.courseId, course.id))
        .orderBy(asc(learningObjectives.number)),
      executor
        .select()
        .from(courseModules)
        .where(eq(courseModules.courseId, course.id))
        .orderBy(asc(courseModules.position)),
    ]);
    const moduleIds = moduleRows.map((module) => module.id);
    const [links, lessonRows] =
      moduleIds.length === 0
        ? [[], []]
        : await Promise.all([
            executor
              .select()
              .from(moduleObjectives)
              .where(inArray(moduleObjectives.moduleId, moduleIds)),
            executor
              .select()
              .from(lessons)
              .where(inArray(lessons.moduleId, moduleIds))
              .orderBy(asc(lessons.position)),
          ]);
    const objectiveNumber = new Map(objectiveRows.map((row) => [row.id, row.number]));

    return {
      course: { id: course.id, code: course.code, title: course.title },
      objectives: objectiveRows.map((row) => ({
        id: row.id,
        code: objectiveCode(row.number),
        description: row.description,
      })),
      modules: moduleRows.map((module) => ({
        id: module.id,
        position: module.position,
        title: module.title,
        description: module.description,
        objectiveIds: links
          .filter((link) => link.moduleId === module.id)
          .map((link) => link.objectiveId)
          .sort((a, b) => (objectiveNumber.get(a) ?? 0) - (objectiveNumber.get(b) ?? 0)),
        requiresPrevious: module.requiresPrevious,
        masteryThreshold: module.masteryThreshold,
        status: module.status,
        lessons: lessonRows
          .filter((lesson) => lesson.moduleId === module.id)
          .map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            position: lesson.position,
            objectiveId: lesson.objectiveId,
            status: lesson.status,
          })),
      })),
    };
  }

  private async findModule(
    executor: DbExecutor,
    courseId: string,
    moduleId: string,
  ): Promise<ModuleRow> {
    const [module] = await executor
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, courseId)));
    if (!module) throw new NotFoundException('No such module in this course.');
    return module;
  }

  private async findLesson(
    executor: DbExecutor,
    courseId: string,
    lessonId: string,
  ): Promise<LessonRow> {
    const [row] = await executor
      .select({ lesson: lessons })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .where(and(eq(lessons.id, lessonId), eq(courseModules.courseId, courseId)));
    if (!row) throw new NotFoundException('No such lesson in this course.');
    return row.lesson;
  }

  private async moduleObjectiveIds(executor: DbExecutor, moduleId: string): Promise<string[]> {
    const rows = await executor
      .select({ objectiveId: moduleObjectives.objectiveId })
      .from(moduleObjectives)
      .where(eq(moduleObjectives.moduleId, moduleId));
    return rows.map((row) => row.objectiveId);
  }

  private async setModuleObjectives(
    executor: DbExecutor,
    moduleId: string,
    objectiveIds: readonly string[],
  ): Promise<void> {
    await executor.delete(moduleObjectives).where(eq(moduleObjectives.moduleId, moduleId));
    if (objectiveIds.length === 0) return;
    await executor
      .insert(moduleObjectives)
      .values([...new Set(objectiveIds)].map((objectiveId) => ({ moduleId, objectiveId })));
  }

  /** Every id must be an objective of this course. */
  private async checkObjectives(
    executor: DbExecutor,
    courseId: string,
    objectiveIds: readonly string[],
  ): Promise<void> {
    const wanted = [...new Set(objectiveIds)];
    if (wanted.length === 0) return;
    const found = await executor
      .select({ id: learningObjectives.id })
      .from(learningObjectives)
      .where(
        and(eq(learningObjectives.courseId, courseId), inArray(learningObjectives.id, wanted)),
      );
    if (found.length !== wanted.length) {
      throw new ConflictException('Choose objectives of this course only.');
    }
  }

  /** A published module keeps an objective, and no lesson may lose the objective it teaches. */
  private async checkObjectivesStillCover(
    executor: DbExecutor,
    module: ModuleRow,
    next: readonly string[],
  ): Promise<void> {
    if (module.status === 'published' && next.length === 0) {
      throw new ConflictException('A published module needs at least one learning objective.');
    }
    const used = await executor
      .select({ title: lessons.title, number: learningObjectives.number, id: lessons.objectiveId })
      .from(lessons)
      .innerJoin(learningObjectives, eq(learningObjectives.id, lessons.objectiveId))
      .where(eq(lessons.moduleId, module.id));
    const orphaned = used.find((lesson) => lesson.id && !next.includes(lesson.id));
    if (orphaned) {
      throw new ConflictException(
        `The lesson "${orphaned.title}" teaches ${objectiveCode(orphaned.number)}. Change that lesson first.`,
      );
    }
  }

  private async checkLessonObjective(
    executor: DbExecutor,
    moduleId: string,
    objectiveId: string | null,
  ): Promise<void> {
    if (objectiveId === null) return;
    if (!(await this.moduleObjectiveIds(executor, moduleId)).includes(objectiveId)) {
      throw new ConflictException("Choose one of this module's learning objectives.");
    }
  }

  private checkPublishable(lesson: Pick<LessonRow, 'objectiveId' | 'body'>): void {
    if (!lesson.objectiveId) {
      throw new ConflictException('Map the lesson to a learning objective before publishing it.');
    }
    if (lesson.body.trim() === '') {
      throw new ConflictException('Write the lesson content before publishing it.');
    }
  }

  private async record(
    tx: DbExecutor,
    editor: ContentEditor,
    action: AuditAction,
    targetType: 'objective' | 'module' | 'lesson',
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

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    moduleId: row.moduleId,
    title: row.title,
    position: row.position,
    objectiveId: row.objectiveId,
    status: row.status,
    body: row.body,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function bodyFingerprint(body: string): { length: number; sha256: string } {
  return { length: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}
