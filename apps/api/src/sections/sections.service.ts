import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  SECTION_PAGE_SIZE,
  type AuditAction,
  type EnrollResult,
  type EnrollSkipReason,
  type RosterEntry,
  type SectionDetails,
  type SectionInput,
  type SectionListQuery,
  type SectionListResponse,
  type SectionSummary,
  type SectionUpdate,
  type StudentClass,
} from '@lead/schema';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AdminChange } from '../admin/admin-users.service';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  classSections,
  courses,
  enrollments,
  teachingAssignments,
  users,
  type UserRow,
} from '../database/schema';

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) => (candidate as { code?: unknown } | null)?.code === UNIQUE_VIOLATION,
  );
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** Live (not dropped) enrollments of a section, as a correlated subquery. */
const enrolledCount = sql<number>`(
  select count(*)::int from ${enrollments}
  where ${enrollments.sectionId} = ${classSections.id} and ${enrollments.status} = 'enrolled'
)`;

/**
 * Sections, teaching assignments and enrollment (wireframes A07, T02, S02). Enrollment locks the
 * section row first, so concurrent requests count seats one at a time and never overfill it.
 */
@Injectable()
export class SectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reading

  /** Sections of one term (the current term by default), for administrators. */
  async list(query: SectionListQuery): Promise<SectionListResponse> {
    const termId = query.term ?? (await this.currentTermId());
    if (!termId) return { items: [], total: 0, page: 1, pageSize: SECTION_PAGE_SIZE, termId: null };

    const conditions: SQL[] = [eq(classSections.termId, termId)];
    if (query.q) {
      const pattern = likePattern(query.q);
      const match = or(
        ilike(courses.code, pattern),
        ilike(courses.title, pattern),
        ilike(classSections.name, pattern),
      );
      if (match) conditions.push(match);
    }
    const where = and(...conditions);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select({ id: classSections.id })
        .from(classSections)
        .innerJoin(courses, eq(courses.id, classSections.courseId))
        .where(where)
        .orderBy(asc(courses.code), asc(classSections.name))
        .limit(SECTION_PAGE_SIZE)
        .offset((query.page - 1) * SECTION_PAGE_SIZE),
      this.db
        .select({ total: count() })
        .from(classSections)
        .innerJoin(courses, eq(courses.id, classSections.courseId))
        .where(where),
    ]);

    return {
      items: await this.summaries(rows.map((row) => row.id)),
      total: totals?.total ?? 0,
      page: query.page,
      pageSize: SECTION_PAGE_SIZE,
      termId,
    };
  }

  async details(sectionId: string, enrolledOnly = false): Promise<SectionDetails> {
    const [summary] = await this.summaries([sectionId]);
    if (!summary) throw new NotFoundException('No such section.');
    return { ...summary, roster: await this.roster(sectionId, enrolledOnly) };
  }

  /** A teacher's own classes (T02). Other sections do not exist as far as they can tell. */
  async teacherClasses(teacher: UserRow, termId?: string): Promise<SectionSummary[]> {
    const term = termId ?? (await this.currentTermId());
    if (!term) return [];
    const rows = await this.db
      .select({ id: classSections.id })
      .from(classSections)
      .innerJoin(teachingAssignments, eq(teachingAssignments.sectionId, classSections.id))
      .where(and(eq(teachingAssignments.teacherId, teacher.id), eq(classSections.termId, term)));
    return this.summaries(rows.map((row) => row.id));
  }

  async teacherClass(teacher: UserRow, sectionId: string): Promise<SectionDetails> {
    const [assigned] = await this.db
      .select({ sectionId: teachingAssignments.sectionId })
      .from(teachingAssignments)
      .where(
        and(
          eq(teachingAssignments.sectionId, sectionId),
          eq(teachingAssignments.teacherId, teacher.id),
        ),
      );
    // Same answer for "not yours" and "does not exist", so section ids cannot be probed.
    if (!assigned) throw new NotFoundException('No such class.');
    // Teachers see who is in the class now; dropped students stay visible to administrators only.
    return this.details(sectionId, true);
  }

  /** A student's enrolled classes (S02), all terms, newest term first. */
  async studentClasses(student: UserRow): Promise<StudentClass[]> {
    const rows = await this.db
      .select({ id: enrollments.sectionId, enrolledAt: enrollments.enrolledAt })
      .from(enrollments)
      .innerJoin(classSections, eq(classSections.id, enrollments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(and(eq(enrollments.studentId, student.id), eq(enrollments.status, 'enrolled')))
      .orderBy(desc(academicTerms.startsOn), asc(courses.code));
    const enrolledAt = new Map(rows.map((row) => [row.id, row.enrolledAt.toISOString()]));
    const summaries = await this.summaries([...enrolledAt.keys()]);
    // Students see their class, not how full it is.
    return summaries.map(({ id, name, course, term, teachers }) => ({
      id,
      name,
      course,
      term,
      teachers,
      enrolledAt: enrolledAt.get(id) ?? '',
    }));
  }

  // ---------- Administrator changes

  async create(input: SectionInput, change: AdminChange): Promise<SectionSummary> {
    const created = await this.db.transaction(async (tx) => {
      // Shared lock: archiving the course waits until this section exists (or fails).
      const [course] = await tx
        .select()
        .from(courses)
        .where(eq(courses.code, input.courseCode))
        .for('share');
      if (!course) throw new NotFoundException(`No course with code ${input.courseCode}.`);
      if (course.archivedAt) throw new ConflictException(`${course.code} is archived.`);
      const [term] = await tx
        .select()
        .from(academicTerms)
        .where(eq(academicTerms.id, input.termId));
      if (!term) throw new NotFoundException('No such term.');

      const [section] = await this.uniquely(
        `${course.code} already has a section named ${input.name} this term.`,
        () =>
          tx
            .insert(classSections)
            .values({
              courseId: course.id,
              termId: term.id,
              name: input.name,
              capacity: input.capacity,
            })
            .returning(),
      );
      if (!section) throw new ConflictException('The section could not be created.');
      await this.record(tx, change, 'section.created', section.id, null, {
        course: course.code,
        termId: term.id,
        name: input.name,
        capacity: input.capacity,
      });
      return section;
    });
    return this.details(created.id);
  }

  async update(
    sectionId: string,
    input: SectionUpdate,
    change: AdminChange,
  ): Promise<SectionSummary> {
    await this.db.transaction(async (tx) => {
      const section = await this.lockSection(tx, sectionId);
      const changes: SectionUpdate = {};
      if (input.name !== undefined && input.name !== section.name) changes.name = input.name;
      if (input.capacity !== undefined && input.capacity !== section.capacity) {
        changes.capacity = input.capacity;
      }
      if (Object.keys(changes).length === 0) return;

      if (changes.capacity !== undefined) {
        const enrolled = await this.countEnrolled(tx, sectionId);
        if (changes.capacity < enrolled) {
          throw new ConflictException(
            `${enrolled} students are enrolled, so the capacity cannot be lower than that.`,
          );
        }
      }
      await this.uniquely('Another section of this course already has that name this term.', () =>
        tx
          .update(classSections)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(classSections.id, sectionId)),
      );
      const before: Record<string, unknown> = {};
      for (const key of Object.keys(changes) as (keyof SectionUpdate)[]) before[key] = section[key];
      await this.record(tx, change, 'section.updated', sectionId, before, { ...changes });
    });
    return this.details(sectionId);
  }

  async assignTeacher(
    sectionId: string,
    email: string,
    change: AdminChange,
  ): Promise<SectionDetails> {
    await this.db.transaction(async (tx) => {
      await this.lockSection(tx, sectionId);
      // Shared lock: a concurrent deactivation waits, so an inactive account is never assigned.
      const [teacher] = await tx.select().from(users).where(eq(users.email, email)).for('share');
      if (!teacher) throw new NotFoundException(`No account uses ${email}.`);
      if (teacher.role !== 'teacher')
        throw new ConflictException(`${email} is not a teacher account.`);
      if (teacher.status !== 'active') throw new ConflictException(`${email} is not active.`);

      const inserted = await tx
        .insert(teachingAssignments)
        .values({ sectionId, teacherId: teacher.id })
        .onConflictDoNothing()
        .returning({ teacherId: teachingAssignments.teacherId });
      if (inserted.length === 0) {
        throw new ConflictException(`${teacher.displayName} already teaches this section.`);
      }
      await this.record(tx, change, 'teacher.assigned', sectionId, null, { teacherId: teacher.id });
    });
    return this.details(sectionId);
  }

  async unassignTeacher(
    sectionId: string,
    teacherId: string,
    change: AdminChange,
  ): Promise<SectionDetails> {
    await this.db.transaction(async (tx) => {
      await this.lockSection(tx, sectionId);
      const removed = await tx
        .delete(teachingAssignments)
        .where(
          and(
            eq(teachingAssignments.sectionId, sectionId),
            eq(teachingAssignments.teacherId, teacherId),
          ),
        )
        .returning({ teacherId: teachingAssignments.teacherId });
      if (removed.length === 0) throw new NotFoundException('That teacher is not assigned here.');
      await this.record(tx, change, 'teacher.unassigned', sectionId, { teacherId }, null);
    });
    return this.details(sectionId);
  }

  /**
   * Enrolls each email that belongs to an active student, until the section is full. Returns who
   * was added and why the rest were skipped; a re-enrolled student keeps their original row.
   */
  async enroll(sectionId: string, emails: string[], change: AdminChange): Promise<EnrollResult> {
    return this.db.transaction(async (tx) => {
      // The lock makes concurrent enrollments in this section take turns, so the seat count
      // below cannot be read by two requests at once.
      const section = await this.lockSection(tx, sectionId);
      let seatsTaken = await this.countEnrolled(tx, sectionId);

      // Shared lock: a concurrent deactivation waits, so an inactive student is never enrolled.
      const found = await tx
        .select()
        .from(users)
        .where(inArray(users.email, emails))
        .orderBy(asc(users.id))
        .for('share');
      const byEmail = new Map(found.map((user) => [user.email, user]));
      const existing = await tx
        .select({ studentId: enrollments.studentId, status: enrollments.status })
        .from(enrollments)
        .where(eq(enrollments.sectionId, sectionId));
      const alreadyIn = new Set(
        existing.filter((row) => row.status === 'enrolled').map((row) => row.studentId),
      );
      const droppedBefore = new Set(
        existing.filter((row) => row.status === 'dropped').map((row) => row.studentId),
      );

      const result: { added: string[]; skipped: { email: string; reason: EnrollSkipReason }[] } = {
        added: [],
        skipped: [],
      };
      for (const email of emails) {
        const user = byEmail.get(email);
        const reason: EnrollSkipReason | null = !user
          ? 'not_found'
          : user.role !== 'student'
            ? 'not_a_student'
            : user.status !== 'active'
              ? 'not_active'
              : alreadyIn.has(user.id)
                ? 'already_enrolled'
                : seatsTaken >= section.capacity
                  ? 'section_full'
                  : null;
        if (reason || !user) {
          result.skipped.push({ email, reason: reason ?? 'not_found' });
          continue;
        }

        await tx
          .insert(enrollments)
          .values({ sectionId, studentId: user.id })
          .onConflictDoUpdate({
            target: [enrollments.sectionId, enrollments.studentId],
            set: { status: 'enrolled', enrolledAt: new Date(), droppedAt: null },
          });
        await this.record(
          tx,
          change,
          'enrollment.added',
          sectionId,
          droppedBefore.has(user.id) ? { studentId: user.id, status: 'dropped' } : null,
          { studentId: user.id, status: 'enrolled' },
        );
        alreadyIn.add(user.id);
        seatsTaken += 1;
        result.added.push(email);
      }
      return result;
    });
  }

  /** Takes a student out of a section; the row stays, marked dropped, with the reason audited. */
  async drop(sectionId: string, studentId: string, change: AdminChange): Promise<SectionDetails> {
    await this.db.transaction(async (tx) => {
      await this.lockSection(tx, sectionId);
      const dropped = await tx
        .update(enrollments)
        .set({ status: 'dropped', droppedAt: new Date() })
        .where(
          and(
            eq(enrollments.sectionId, sectionId),
            eq(enrollments.studentId, studentId),
            eq(enrollments.status, 'enrolled'),
          ),
        )
        .returning({ studentId: enrollments.studentId });
      if (dropped.length === 0) throw new NotFoundException('That student is not enrolled here.');
      await this.record(
        tx,
        change,
        'enrollment.dropped',
        sectionId,
        { studentId, status: 'enrolled' },
        { studentId, status: 'dropped' },
      );
    });
    return this.details(sectionId);
  }

  // ---------- Helpers

  /** Builds summaries for these sections, in the order given. */
  private async summaries(sectionIds: string[]): Promise<SectionSummary[]> {
    if (sectionIds.length === 0) return [];
    const [rows, teacherRows] = await Promise.all([
      this.db
        .select({
          section: classSections,
          course: courses,
          term: academicTerms,
          enrolled: enrolledCount,
        })
        .from(classSections)
        .innerJoin(courses, eq(courses.id, classSections.courseId))
        .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
        .where(inArray(classSections.id, sectionIds)),
      this.db
        .select({
          sectionId: teachingAssignments.sectionId,
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        })
        .from(teachingAssignments)
        .innerJoin(users, eq(users.id, teachingAssignments.teacherId))
        .where(inArray(teachingAssignments.sectionId, sectionIds))
        .orderBy(asc(users.displayName)),
    ]);

    const byId = new Map(
      rows.map(({ section, course, term, enrolled }) => [
        section.id,
        {
          id: section.id,
          name: section.name,
          capacity: section.capacity,
          enrolled,
          course: { id: course.id, code: course.code, title: course.title, units: course.units },
          term: {
            id: term.id,
            schoolYear: term.schoolYear,
            semester: term.semester,
            current: term.current,
          },
          teachers: teacherRows
            .filter((teacher) => teacher.sectionId === section.id)
            .map(({ id, displayName, email }) => ({ id, displayName, email })),
        } satisfies SectionSummary,
      ]),
    );
    return sectionIds.flatMap((id) => {
      const summary = byId.get(id);
      return summary ? [summary] : [];
    });
  }

  private async roster(sectionId: string, enrolledOnly: boolean): Promise<RosterEntry[]> {
    const rows = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        status: enrollments.status,
        enrolledAt: enrollments.enrolledAt,
        droppedAt: enrollments.droppedAt,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.sectionId, sectionId),
          enrolledOnly ? eq(enrollments.status, 'enrolled') : undefined,
        ),
      )
      .orderBy(desc(sql`${enrollments.status} = 'enrolled'`), asc(users.displayName));
    return rows.map((row) => ({
      ...row,
      enrolledAt: row.enrolledAt.toISOString(),
      droppedAt: row.droppedAt?.toISOString() ?? null,
    }));
  }

  private async currentTermId(): Promise<string | null> {
    const [term] = await this.db
      .select({ id: academicTerms.id })
      .from(academicTerms)
      .where(eq(academicTerms.current, true));
    return term?.id ?? null;
  }

  private async lockSection(tx: DbExecutor, sectionId: string) {
    const [section] = await tx
      .select()
      .from(classSections)
      .where(eq(classSections.id, sectionId))
      .for('update');
    if (!section) throw new NotFoundException('No such section.');
    return section;
  }

  private async countEnrolled(tx: DbExecutor, sectionId: string): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(enrollments)
      .where(and(eq(enrollments.sectionId, sectionId), eq(enrollments.status, 'enrolled')));
    return row?.total ?? 0;
  }

  private async uniquely<T>(message: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(message);
      throw error;
    }
  }

  private async record(
    tx: DbExecutor,
    change: AdminChange,
    action: AuditAction,
    sectionId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: change.admin.id,
        actorRole: change.admin.role,
        action,
        targetType: 'section',
        targetId: sectionId,
        outcome: 'success',
        reason: change.reason,
        before,
        after,
        ipAddress: change.client.ipAddress,
        userAgent: change.client.userAgent,
      },
      tx,
    );
  }
}
