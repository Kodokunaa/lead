import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  COURSE_PAGE_SIZE,
  type AuditAction,
  type Course,
  type CourseInput,
  type CourseListQuery,
  type CourseListResponse,
  type CourseUpdate,
  type Program,
  type ProgramInput,
  type ProgramUpdate,
  type Term,
  type TermInput,
} from '@lead/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AdminChange } from '../admin/admin-users.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  courses,
  programs,
  type CourseRow,
  type ProgramRow,
  type TermRow,
} from '../database/schema';

const UNIQUE_VIOLATION = '23505';
/** Advisory lock key that serializes changes of the current term. */
export const CURRENT_TERM_LOCK = 742_002;

/** Postgres unique-index violation, as thrown directly or wrapped by Drizzle. */
function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) => (candidate as { code?: unknown } | null)?.code === UNIQUE_VIOLATION,
  );
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function toProgram(row: ProgramRow): Program {
  return { id: row.id, code: row.code, name: row.name, active: row.active };
}

function toTerm(row: TermRow): Term {
  return {
    id: row.id,
    schoolYear: row.schoolYear,
    semester: row.semester,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    current: row.current,
  };
}

function toCourse(row: CourseRow, programCode: string | null): Course {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    units: row.units,
    programId: row.programId,
    programCode,
    archived: row.archivedAt !== null,
  };
}

/** The course catalog: programs, academic terms and courses (wireframe A05). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Programs

  async listPrograms(): Promise<Program[]> {
    const rows = await this.db.select().from(programs).orderBy(asc(programs.code));
    return rows.map(toProgram);
  }

  async createProgram(input: ProgramInput, change: AdminChange): Promise<Program> {
    return this.db.transaction(async (tx) => {
      const [created] = await this.uniquely('A program with this code already exists.', () =>
        tx.insert(programs).values(input).returning(),
      );
      if (!created) throw new ConflictException('A program with this code already exists.');
      await this.record(tx, change, 'program.created', 'program', created.id, null, input);
      return toProgram(created);
    });
  }

  async updateProgram(id: string, input: ProgramUpdate, change: AdminChange): Promise<Program> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(programs).where(eq(programs.id, id)).for('update');
      if (!before) throw new NotFoundException('No such program.');
      const changes = changedFields(before, input);
      if (Object.keys(changes).length === 0) return toProgram(before);

      const [updated] = await tx
        .update(programs)
        .set(changes)
        .where(eq(programs.id, id))
        .returning();
      if (!updated) throw new NotFoundException('No such program.');
      await this.record(
        tx,
        change,
        'program.updated',
        'program',
        id,
        pick(before, changes),
        changes,
      );
      return toProgram(updated);
    });
  }

  // ---------- Terms

  async listTerms(): Promise<Term[]> {
    const rows = await this.db.select().from(academicTerms).orderBy(desc(academicTerms.startsOn));
    return rows.map(toTerm);
  }

  async createTerm(input: TermInput, change: AdminChange): Promise<Term> {
    return this.db.transaction(async (tx) => {
      const [created] = await this.uniquely(
        'This semester already exists for that school year.',
        () => tx.insert(academicTerms).values(input).returning(),
      );
      if (!created)
        throw new ConflictException('This semester already exists for that school year.');
      await this.record(tx, change, 'term.created', 'term', created.id, null, input);
      return toTerm(created);
    });
  }

  /** The current term is what new sections and dashboards default to. Exactly one at a time. */
  async makeCurrent(id: string, change: AdminChange): Promise<Term> {
    return this.db.transaction(async (tx) => {
      // One switch at a time: two admins choosing different terms at once would otherwise both
      // clear the old term and then collide on the one-current-term index.
      await tx.execute(sql`select pg_advisory_xact_lock(${CURRENT_TERM_LOCK})`);
      const [target] = await tx
        .select()
        .from(academicTerms)
        .where(eq(academicTerms.id, id))
        .for('update');
      if (!target) throw new NotFoundException('No such term.');
      if (target.current) return toTerm(target);

      const [previous] = await tx
        .update(academicTerms)
        .set({ current: false })
        .where(eq(academicTerms.current, true))
        .returning({ id: academicTerms.id });
      const [updated] = await tx
        .update(academicTerms)
        .set({ current: true })
        .where(eq(academicTerms.id, id))
        .returning();
      if (!updated) throw new NotFoundException('No such term.');
      await this.record(
        tx,
        change,
        'term.made_current',
        'term',
        id,
        { currentTermId: previous?.id ?? null },
        { currentTermId: id },
      );
      return toTerm(updated);
    });
  }

  // ---------- Courses

  async listCourses(query: CourseListQuery): Promise<CourseListResponse> {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = likePattern(query.q);
      const match = or(ilike(courses.code, pattern), ilike(courses.title, pattern));
      if (match) conditions.push(match);
    }
    if (query.program === 'general') conditions.push(isNull(courses.programId));
    else if (query.program) conditions.push(eq(courses.programId, query.program));
    if (query.archived === 'true') conditions.push(isNotNull(courses.archivedAt));
    else conditions.push(isNull(courses.archivedAt));
    const where = and(...conditions);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select({ course: courses, programCode: programs.code })
        .from(courses)
        .leftJoin(programs, eq(programs.id, courses.programId))
        .where(where)
        .orderBy(asc(courses.code))
        .limit(COURSE_PAGE_SIZE)
        .offset((query.page - 1) * COURSE_PAGE_SIZE),
      this.db.select({ total: count() }).from(courses).where(where),
    ]);

    return {
      items: rows.map((row) => toCourse(row.course, row.programCode)),
      total: totals?.total ?? 0,
      page: query.page,
      pageSize: COURSE_PAGE_SIZE,
    };
  }

  async createCourse(input: CourseInput, change: AdminChange): Promise<Course> {
    return this.db.transaction(async (tx) => {
      const programCode = await this.activeProgramCode(tx, input.programId);
      const [created] = await this.uniquely(
        `A course with code ${input.code} already exists.`,
        () => tx.insert(courses).values(input).returning(),
      );
      if (!created) throw new ConflictException(`A course with code ${input.code} already exists.`);
      await this.record(tx, change, 'course.created', 'course', created.id, null, input);
      return toCourse(created, programCode);
    });
  }

  async updateCourse(id: string, input: CourseUpdate, change: AdminChange): Promise<Course> {
    return this.db.transaction(async (tx) => {
      const before = await this.lockCourse(tx, id);
      const changes = changedFields(before, input);
      if (Object.keys(changes).length === 0) {
        return toCourse(before, await this.programCode(tx, before.programId));
      }
      // Moving a course to another program needs that program to be active; keeping it is fine.
      const programCode =
        changes.programId === undefined
          ? await this.programCode(tx, before.programId)
          : await this.activeProgramCode(tx, changes.programId);
      const code = changes.code ?? before.code;
      const [updated] = await this.uniquely(`A course with code ${code} already exists.`, () =>
        tx
          .update(courses)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(courses.id, id))
          .returning(),
      );
      if (!updated) throw new NotFoundException('No such course.');
      await this.record(tx, change, 'course.updated', 'course', id, pick(before, changes), changes);
      return toCourse(updated, programCode);
    });
  }

  async archiveCourse(id: string, change: AdminChange): Promise<Course> {
    return this.setArchived(id, change, true);
  }

  async restoreCourse(id: string, change: AdminChange): Promise<Course> {
    return this.setArchived(id, change, false);
  }

  private async setArchived(id: string, change: AdminChange, archive: boolean): Promise<Course> {
    return this.db.transaction(async (tx) => {
      const before = await this.lockCourse(tx, id);
      if ((before.archivedAt !== null) === archive) {
        throw new ConflictException(
          archive ? 'The course is already archived.' : 'The course is not archived.',
        );
      }
      const [updated] = await tx
        .update(courses)
        .set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() })
        .where(eq(courses.id, id))
        .returning();
      if (!updated) throw new NotFoundException('No such course.');
      await this.record(
        tx,
        change,
        archive ? 'course.archived' : 'course.restored',
        'course',
        id,
        { archived: !archive },
        { archived: archive },
      );
      return toCourse(updated, await this.programCode(tx, updated.programId));
    });
  }

  private async lockCourse(tx: DbExecutor, id: string): Promise<CourseRow> {
    const [course] = await tx.select().from(courses).where(eq(courses.id, id)).for('update');
    if (!course) throw new NotFoundException('No such course.');
    return course;
  }

  private async programCode(tx: DbExecutor, programId: string | null): Promise<string | null> {
    if (!programId) return null;
    const [program] = await tx.select().from(programs).where(eq(programs.id, programId));
    return program?.code ?? null;
  }

  /** New courses only go under programs that are still offered. */
  private async activeProgramCode(
    tx: DbExecutor,
    programId: string | null,
  ): Promise<string | null> {
    if (!programId) return null;
    // FOR SHARE: a deactivation running at the same moment waits until this course is saved.
    const [program] = await tx
      .select()
      .from(programs)
      .where(eq(programs.id, programId))
      .for('share');
    if (!program) throw new NotFoundException('No such program.');
    if (!program.active) throw new ConflictException(`${program.code} is no longer offered.`);
    return program.code;
  }

  /** Turns a unique-index violation into a 409 with a message people can act on. */
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
    targetType: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: change.admin.id,
        actorRole: change.admin.role,
        action,
        targetType,
        targetId,
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

/** The fields of `patch` whose values differ from `row`; equal values are left out. */
function changedFields<P extends object>(row: object, patch: P): Partial<P> {
  const result: Partial<P> = {};
  for (const key of Object.keys(patch) as (keyof P)[]) {
    if (
      patch[key] !== undefined &&
      (row as Record<string, unknown>)[key as string] !== patch[key]
    ) {
      result[key] = patch[key];
    }
  }
  return result;
}

/** The fields an update touches, as they were before it. */
function pick<T extends object>(row: T, patch: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const value = (row as Record<string, unknown>)[key];
    result[key] = value instanceof Date ? value.toISOString() : value;
  }
  return result;
}
