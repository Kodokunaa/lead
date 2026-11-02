import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseOffering, CourseRecord } from '@lead/schema';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module';
import {
  academicTerms,
  classSections,
  courseModules,
  courses,
  enrollments,
  learningObjectives,
  lessons,
  programs,
  resources,
  resourceVersions,
  teachingAssignments,
  users,
} from '../database/schema';
import { toCourse } from './catalog.service';

/** Live (not dropped) enrollments of a section, as a correlated subquery. */
const enrolledCount = sql<number>`(
  select count(*)::int from ${enrollments}
  where ${enrollments.sectionId} = ${classSections.id} and ${enrollments.status} = 'enrolled'
)`;

/**
 * The status of a resource's newest version. The outer column is named in full: in a query on
 * one table Drizzle writes it as a bare "id", which inside the subquery means the version's id.
 */
const latestStatus = sql<string>`(
  select v.status from ${resourceVersions} v
  where v.resource_id = ${sql.identifier('resources')}.${sql.identifier('id')}
  order by v.number desc limit 1
)`;

/**
 * A06 Course offering and curriculum record: one course, the terms and sections that teach it
 * with their teachers, and how far its content and resources have come. Read-only; the course
 * itself is changed through the catalog's update, archive and restore.
 */
@Injectable()
export class CourseRecordService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(courseId: string): Promise<CourseRecord> {
    const [row] = await this.db
      .select({ course: courses, programCode: programs.code })
      .from(courses)
      .leftJoin(programs, eq(programs.id, courses.programId))
      .where(eq(courses.id, courseId));
    if (!row) throw new NotFoundException('No such course.');

    const [offerings, content, resourceCounts] = await Promise.all([
      this.offerings(courseId),
      this.content(courseId),
      this.resources(courseId),
    ]);
    return {
      course: toCourse(row.course, row.programCode),
      offerings,
      content,
      resources: resourceCounts,
    };
  }

  private async offerings(courseId: string): Promise<CourseOffering[]> {
    const sectionRows = await this.db
      .select({ section: classSections, term: academicTerms, enrolled: enrolledCount })
      .from(classSections)
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .where(eq(classSections.courseId, courseId))
      .orderBy(desc(academicTerms.startsOn), asc(classSections.name));
    if (sectionRows.length === 0) return [];

    const teacherRows = await this.db
      .select({
        sectionId: teachingAssignments.sectionId,
        id: users.id,
        displayName: users.displayName,
      })
      .from(teachingAssignments)
      .innerJoin(users, eq(users.id, teachingAssignments.teacherId))
      .where(
        inArray(
          teachingAssignments.sectionId,
          sectionRows.map((row) => row.section.id),
        ),
      )
      .orderBy(asc(users.displayName));

    const byTerm = new Map<string, CourseOffering>();
    for (const { section, term, enrolled } of sectionRows) {
      const offering = byTerm.get(term.id) ?? {
        term: {
          id: term.id,
          schoolYear: term.schoolYear,
          semester: term.semester,
          current: term.current,
        },
        sections: [],
      };
      byTerm.set(term.id, {
        ...offering,
        sections: [
          ...offering.sections,
          {
            id: section.id,
            name: section.name,
            capacity: section.capacity,
            enrolled,
            teachers: teacherRows
              .filter((teacher) => teacher.sectionId === section.id)
              .map(({ id, displayName }) => ({ id, displayName })),
          },
        ],
      });
    }
    return [...byTerm.values()];
  }

  private async content(courseId: string): Promise<CourseRecord['content']> {
    const [[objectives], [modules], [lessonCounts]] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(learningObjectives)
        .where(eq(learningObjectives.courseId, courseId)),
      this.db
        .select({
          total: count(),
          published: sql<number>`count(*) filter (where ${courseModules.status} = 'published')::int`,
        })
        .from(courseModules)
        .where(eq(courseModules.courseId, courseId)),
      this.db
        .select({
          total: count(),
          published: sql<number>`count(*) filter (where ${lessons.status} = 'published')::int`,
        })
        .from(lessons)
        .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
        .where(eq(courseModules.courseId, courseId)),
    ]);
    return {
      objectives: objectives?.total ?? 0,
      modules: modules?.total ?? 0,
      publishedModules: modules?.published ?? 0,
      lessons: lessonCounts?.total ?? 0,
      publishedLessons: lessonCounts?.published ?? 0,
    };
  }

  private async resources(courseId: string): Promise<CourseRecord['resources']> {
    const rows = await this.db
      .select({ status: latestStatus })
      .from(resources)
      .where(eq(resources.courseId, courseId));
    // "Approved" counts resources learners can open now: any version approved, not only the newest.
    const [approved] = await this.db
      .select({ total: sql<number>`count(distinct ${resourceVersions.resourceId})::int` })
      .from(resourceVersions)
      .innerJoin(resources, eq(resources.id, resourceVersions.resourceId))
      .where(and(eq(resources.courseId, courseId), eq(resourceVersions.status, 'approved')));
    return {
      total: rows.length,
      approved: approved?.total ?? 0,
      pending: rows.filter((row) => row.status === 'pending').length,
    };
  }
}
