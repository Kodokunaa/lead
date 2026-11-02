import { Inject, Injectable } from '@nestjs/common';
import {
  RESOURCE_STATUS_LABELS,
  SEARCH_LIMIT_PER_TYPE,
  SEMESTER_LABELS,
  type ResourceStatus,
  type SearchResponse,
  type SearchResult,
} from '@lead/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module';
import {
  academicTerms,
  classSections,
  courseModules,
  courses,
  enrollments,
  lessons,
  resources,
  resourceVersions,
  teachingAssignments,
  users,
  type UserRow,
} from '../database/schema';

const LIMIT = SEARCH_LIMIT_PER_TYPE;

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * The status of a resource's newest version. The outer column is named in full: in a query on
 * one table Drizzle writes it as a bare "id", which inside the subquery means the version's id.
 */
const latestStatus = sql<ResourceStatus>`(
  select v.status from ${resourceVersions} v
  where v.resource_id = ${sql.identifier('resources')}.${sql.identifier('id')}
  order by v.number desc limit 1
)`;

/** Up to LIMIT results, and whether there were more. */
function capped<T>(rows: T[]): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, LIMIT), more: rows.length > LIMIT };
}

/**
 * Permission-scoped search (wireframe H09). Every query is built from what the searcher may
 * open, by role, so nothing outside that scope can match, whatever is typed.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async search(user: UserRow, query: string): Promise<SearchResponse> {
    const pattern = likePattern(query);
    // For rows already loaded (the searcher's own classes), matched the same way as ILIKE.
    const needle = query.toLowerCase();
    const groups =
      user.role === 'student'
        ? await this.forStudent(user, pattern, needle)
        : user.role === 'teacher'
          ? await this.forTeacher(user, pattern, needle)
          : await this.forAdmin(pattern);
    return {
      query,
      results: groups.flatMap((group) => group.rows),
      truncated: groups.some((group) => group.more),
    };
  }

  // ---------- Students: their classes, and published lessons and approved resources in them

  private async forStudent(student: UserRow, pattern: string, needle: string) {
    const enrolled = await this.db
      .select({ section: classSections, course: courses, term: academicTerms })
      .from(enrollments)
      .innerJoin(classSections, eq(classSections.id, enrollments.sectionId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .where(and(eq(enrollments.studentId, student.id), eq(enrollments.status, 'enrolled')))
      .orderBy(desc(academicTerms.startsOn));
    if (enrolled.length === 0) return [];
    // Content belongs to the course; open it through the student's newest section of it.
    const sectionOf = new Map<string, string>();
    for (const row of enrolled) {
      if (!sectionOf.has(row.course.id)) sectionOf.set(row.course.id, row.section.id);
    }
    const courseIds = [...sectionOf.keys()];
    const matches = (text: string) => text.toLowerCase().includes(needle);

    const classes = capped(
      enrolled
        .filter(
          (row) =>
            matches(row.course.code) || matches(row.course.title) || matches(row.section.name),
        )
        .map((row): SearchResult => ({
          type: 'class',
          id: row.section.id,
          title: `${row.course.code} · ${row.course.title}`,
          context: `${row.section.name} · ${SEMESTER_LABELS[row.term.semester]} ${row.term.schoolYear}`,
          access: 'Enrolled',
          target: { screen: 'S03', sectionId: row.section.id },
        })),
    );

    const lessonRows = await this.db
      .select({
        id: lessons.id,
        title: lessons.title,
        courseId: courseModules.courseId,
        module: courseModules.title,
        code: courses.code,
      })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, courseModules.courseId))
      .where(
        and(
          inArray(courseModules.courseId, courseIds),
          eq(courseModules.status, 'published'),
          eq(lessons.status, 'published'),
          or(ilike(lessons.title, pattern), ilike(lessons.body, pattern)),
        ),
      )
      .orderBy(asc(courses.code), asc(lessons.title))
      .limit(LIMIT + 1);

    const resourceRows = await this.db
      .select({
        id: resources.id,
        title: resources.title,
        courseId: resources.courseId,
        code: courses.code,
        module: courseModules.title,
      })
      .from(resourceVersions)
      .innerJoin(resources, eq(resources.id, resourceVersions.resourceId))
      .innerJoin(courses, eq(courses.id, resources.courseId))
      .leftJoin(courseModules, eq(courseModules.id, resources.moduleId))
      .where(
        and(
          inArray(resources.courseId, courseIds),
          eq(resourceVersions.status, 'approved'),
          or(isNull(resources.moduleId), eq(courseModules.status, 'published')),
          ilike(resources.title, pattern),
        ),
      )
      .orderBy(asc(courses.code), asc(resources.title))
      .limit(LIMIT + 1);

    return [
      classes,
      capped(
        lessonRows.map((row): SearchResult => ({
          type: 'lesson',
          id: row.id,
          title: row.title,
          context: `${row.code} · ${row.module}`,
          access: 'Enrolled',
          target: { screen: 'S05', sectionId: sectionOf.get(row.courseId)!, lessonId: row.id },
        })),
      ),
      capped(
        resourceRows.map((row): SearchResult => ({
          type: 'resource',
          id: row.id,
          title: row.title,
          context: `${row.code} · ${row.module ?? 'Whole course'}`,
          access: 'Approved',
          target: {
            screen: 'S06',
            sectionId: sectionOf.get(row.courseId)!,
            resourceId: row.id,
          },
        })),
      ),
    ];
  }

  // ---------- Teachers: their classes this term, and those courses' content

  private async forTeacher(teacher: UserRow, pattern: string, needle: string) {
    const teaching = await this.db
      .select({ section: classSections, course: courses })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .where(and(eq(teachingAssignments.teacherId, teacher.id), eq(academicTerms.current, true)))
      .orderBy(asc(courses.code), asc(classSections.name));
    if (teaching.length === 0) return [];
    // Content of archived courses is read-only and left out of Course Content; search matches it.
    const courseIds = [
      ...new Set(teaching.filter((row) => !row.course.archivedAt).map((row) => row.course.id)),
    ];
    const matches = (text: string) => text.toLowerCase().includes(needle);

    const classes = capped(
      teaching
        .filter(
          (row) =>
            matches(row.course.code) || matches(row.course.title) || matches(row.section.name),
        )
        .map((row): SearchResult => ({
          type: 'class',
          id: row.section.id,
          title: `${row.course.code} · ${row.section.name}`,
          context: row.course.title,
          access: 'Teaching',
          target: { screen: 'T03', sectionId: row.section.id },
        })),
    );

    if (courseIds.length === 0) return [classes];
    const [moduleRows, lessonRows, resourceRows] = await Promise.all([
      this.db
        .select({ module: courseModules, code: courses.code })
        .from(courseModules)
        .innerJoin(courses, eq(courses.id, courseModules.courseId))
        .where(and(inArray(courseModules.courseId, courseIds), ilike(courseModules.title, pattern)))
        .orderBy(asc(courses.code), asc(courseModules.position))
        .limit(LIMIT + 1),
      this.db
        .select({ lesson: lessons, module: courseModules, code: courses.code })
        .from(lessons)
        .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
        .innerJoin(courses, eq(courses.id, courseModules.courseId))
        .where(
          and(
            inArray(courseModules.courseId, courseIds),
            or(ilike(lessons.title, pattern), ilike(lessons.body, pattern)),
          ),
        )
        .orderBy(asc(courses.code), asc(lessons.title))
        .limit(LIMIT + 1),
      this.db
        .select({ resource: resources, code: courses.code, status: latestStatus })
        .from(resources)
        .innerJoin(courses, eq(courses.id, resources.courseId))
        .where(and(inArray(resources.courseId, courseIds), ilike(resources.title, pattern)))
        .orderBy(asc(courses.code), asc(resources.title))
        .limit(LIMIT + 1),
    ]);

    return [
      classes,
      capped(
        moduleRows.map(({ module, code }): SearchResult => ({
          type: 'module',
          id: module.id,
          title: module.title,
          context: `${code} · Module ${module.position}`,
          access: module.status === 'published' ? 'Published' : 'Draft',
          target: { screen: 'T05', courseId: module.courseId, moduleId: module.id },
        })),
      ),
      capped(
        lessonRows.map(({ lesson, module, code }): SearchResult => ({
          type: 'lesson',
          id: lesson.id,
          title: lesson.title,
          context: `${code} · ${module.title}`,
          access: lesson.status === 'published' ? 'Published' : 'Draft',
          target: { screen: 'T06', courseId: module.courseId, lessonId: lesson.id },
        })),
      ),
      capped(
        resourceRows.map(({ resource, code, status }): SearchResult => ({
          type: 'resource',
          id: resource.id,
          title: resource.title,
          context: code,
          access: RESOURCE_STATUS_LABELS[status],
          target: { screen: 'T07', courseId: resource.courseId },
        })),
      ),
    ];
  }

  // ---------- Administrators: accounts, the catalog, sections and resources

  private async forAdmin(pattern: string) {
    const [userRows, courseRows, sectionRows, resourceRows] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(or(ilike(users.displayName, pattern), ilike(users.email, pattern)))
        .orderBy(asc(users.displayName))
        .limit(LIMIT + 1),
      this.db
        .select()
        .from(courses)
        .where(or(ilike(courses.code, pattern), ilike(courses.title, pattern)))
        .orderBy(asc(courses.code))
        .limit(LIMIT + 1),
      this.db
        .select({ section: classSections, course: courses, term: academicTerms })
        .from(classSections)
        .innerJoin(courses, eq(courses.id, classSections.courseId))
        .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
        .where(
          or(
            ilike(courses.code, pattern),
            ilike(courses.title, pattern),
            ilike(classSections.name, pattern),
          ) as SQL,
        )
        .orderBy(desc(academicTerms.startsOn), asc(courses.code), asc(classSections.name))
        .limit(LIMIT + 1),
      this.db
        .select({ resource: resources, code: courses.code, status: latestStatus })
        .from(resources)
        .innerJoin(courses, eq(courses.id, resources.courseId))
        .where(or(ilike(resources.title, pattern), ilike(courses.code, pattern)))
        .orderBy(asc(courses.code), asc(resources.title))
        .limit(LIMIT + 1),
    ]);

    return [
      capped(
        userRows.map((row): SearchResult => ({
          type: 'user',
          id: row.id,
          title: row.displayName,
          context: `${row.email} · ${row.role}`,
          access: row.status,
          target: { screen: 'A03', userId: row.id },
        })),
      ),
      capped(
        courseRows.map((row): SearchResult => ({
          type: 'course',
          id: row.id,
          title: `${row.code} · ${row.title}`,
          context: 'Course catalog',
          access: row.archivedAt ? 'Archived' : 'Active',
          target: { screen: 'A05' },
        })),
      ),
      capped(
        sectionRows.map(({ section, course, term }): SearchResult => ({
          type: 'section',
          id: section.id,
          title: `${course.code} · ${section.name}`,
          context: `${SEMESTER_LABELS[term.semester]} ${term.schoolYear}`,
          access: term.current ? 'Current term' : 'Other term',
          target: { screen: 'A07', sectionId: section.id },
        })),
      ),
      capped(
        resourceRows.map(({ resource, code, status }): SearchResult => ({
          type: 'resource',
          id: resource.id,
          title: resource.title,
          context: code,
          access: RESOURCE_STATUS_LABELS[status],
          target: { screen: 'A11', resourceId: resource.id },
        })),
      ),
    ];
  }
}
