import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Objective,
  StudentClassOverview,
  StudentLesson,
  StudentModule,
  StudentResourceView,
} from '@lead/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { CalendarService } from '../calendar/calendar.service';
import { DATABASE, type Database } from '../database/database.module';
import {
  academicTerms,
  classSections,
  courseModules,
  courses,
  enrollments,
  learningObjectives,
  lessons,
  moduleObjectives,
  type CourseRow,
  type TermRow,
  type UserRow,
} from '../database/schema';
import { ResourcesService, type OpenedFile } from '../resources/resources.service';
import { SectionsService } from '../sections/sections.service';

interface EnrolledClass {
  readonly course: CourseRow;
  readonly term: TermRow;
}

/**
 * A class as its enrolled students see it (wireframes S03, S05, S06). Only students enrolled
 * (not dropped) in the section get anything; everyone else gets the same 404 as a missing class.
 * Students see published modules and lessons, and only the approved version of a resource.
 */
@Injectable()
export class LearningService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sections: SectionsService,
    private readonly calendar: CalendarService,
    private readonly resources: ResourcesService,
  ) {}

  async overview(student: UserRow, sectionId: string): Promise<StudentClassOverview> {
    const { course, term } = await this.enrolledClass(student, sectionId);
    const section = (await this.sections.studentClasses(student)).find(
      (item) => item.id === sectionId,
    );
    if (!section) throw new NotFoundException('No such class.');
    const [objectives, modules, resources, calendar] = await Promise.all([
      this.objectivesOf(course.id),
      this.publishedModules(course.id),
      this.resources.approvedForCourse(course.id),
      this.calendar.forClass(term, course.id),
    ]);
    // Objectives only draft modules teach are not shown yet.
    const taught = new Set(modules.flatMap((module) => module.objectiveIds));
    return {
      section,
      objectives: objectives.filter((objective) => taught.has(objective.id)),
      modules,
      resources,
      calendar,
    };
  }

  async lesson(student: UserRow, sectionId: string, lessonId: string): Promise<StudentLesson> {
    const { course } = await this.enrolledClass(student, sectionId);
    const [row] = await this.db
      .select({ lesson: lessons, module: courseModules })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .where(
        and(
          eq(lessons.id, lessonId),
          eq(courseModules.courseId, course.id),
          eq(lessons.status, 'published'),
          eq(courseModules.status, 'published'),
        ),
      );
    // Drafts, and lessons of draft modules, do not exist as far as students can tell.
    if (!row) throw new NotFoundException('No such lesson.');
    const [objectives, siblings, resources] = await Promise.all([
      this.objectivesOf(course.id),
      this.publishedLessons([row.module.id]),
      this.resources.approvedForCourse(course.id, row.module.id),
    ]);
    return {
      id: row.lesson.id,
      title: row.lesson.title,
      body: row.lesson.body,
      objective: objectives.find((objective) => objective.id === row.lesson.objectiveId) ?? null,
      course: { code: course.code, title: course.title },
      module: {
        id: row.module.id,
        position: row.module.position,
        title: row.module.title,
        lessons: siblings,
      },
      resources,
    };
  }

  async resource(
    student: UserRow,
    sectionId: string,
    resourceId: string,
  ): Promise<StudentResourceView> {
    const { course } = await this.enrolledClass(student, sectionId);
    return this.resources.approvedResource(course.id, resourceId);
  }

  async resourceFile(student: UserRow, sectionId: string, resourceId: string): Promise<OpenedFile> {
    const { course } = await this.enrolledClass(student, sectionId);
    return this.resources.approvedFile(course.id, resourceId);
  }

  // ---------- Helpers

  private async enrolledClass(student: UserRow, sectionId: string): Promise<EnrolledClass> {
    const [row] = await this.db
      .select({ course: courses, term: academicTerms })
      .from(enrollments)
      .innerJoin(classSections, eq(classSections.id, enrollments.sectionId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .where(
        and(
          eq(enrollments.sectionId, sectionId),
          eq(enrollments.studentId, student.id),
          eq(enrollments.status, 'enrolled'),
        ),
      );
    if (!row) throw new NotFoundException('No such class.');
    return row;
  }

  private async objectivesOf(courseId: string): Promise<Objective[]> {
    const rows = await this.db
      .select()
      .from(learningObjectives)
      .where(eq(learningObjectives.courseId, courseId))
      .orderBy(asc(learningObjectives.number));
    return rows.map((row) => ({
      id: row.id,
      code: `O${row.number}`,
      description: row.description,
    }));
  }

  private async publishedModules(courseId: string): Promise<StudentModule[]> {
    const modules = await this.db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.courseId, courseId), eq(courseModules.status, 'published')))
      .orderBy(asc(courseModules.position));
    const ids = modules.map((module) => module.id);
    if (ids.length === 0) return [];
    const [links, lessonRows] = await Promise.all([
      this.db.select().from(moduleObjectives).where(inArray(moduleObjectives.moduleId, ids)),
      this.publishedLessonRows(ids),
    ]);
    // Positions shown to students count published modules only, so there are no gaps.
    return modules.map((module, index) => ({
      id: module.id,
      position: index + 1,
      title: module.title,
      description: module.description,
      objectiveIds: links
        .filter((link) => link.moduleId === module.id)
        .map((link) => link.objectiveId),
      requiresPrevious: module.requiresPrevious,
      masteryThreshold: module.masteryThreshold,
      lessons: toLessonRefs(lessonRows.filter((lesson) => lesson.moduleId === module.id)),
    }));
  }

  private async publishedLessons(moduleIds: string[]) {
    return toLessonRefs(await this.publishedLessonRows(moduleIds));
  }

  private async publishedLessonRows(moduleIds: string[]) {
    return this.db
      .select()
      .from(lessons)
      .where(and(inArray(lessons.moduleId, moduleIds), eq(lessons.status, 'published')))
      .orderBy(asc(lessons.position));
  }
}

function toLessonRefs(
  rows: readonly { id: string; title: string; objectiveId: string | null }[],
): StudentModule['lessons'] {
  return rows.map((row, index) => ({
    id: row.id,
    title: row.title,
    position: index + 1,
    objectiveId: row.objectiveId,
  }));
}
