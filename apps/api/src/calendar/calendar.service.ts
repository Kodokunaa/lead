import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuditAction,
  CalendarEvent,
  CalendarEventInput,
  ClassCalendar,
  GradingPeriod,
  GradingPeriodsRequest,
  Offering,
  TermCalendar,
  TermDates,
} from '@lead/schema';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { AdminChange } from '../admin/admin-users.service';
import { AuditService } from '../audit/audit.service';
import { toTerm } from '../catalog/catalog.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  calendarEventCourses,
  calendarEvents,
  classSections,
  courses,
  gradingPeriods,
  teachingAssignments,
  type TermRow,
  type UserRow,
} from '../database/schema';

const UNIQUE_VIOLATION = '23505';

/**
 * Period names are checked for repeats before saving, but Postgres lowercases some letters
 * differently from JavaScript; a pair only the database sees as equal is still a 409, not a 500.
 */
async function uniquely<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const code = [error, (error as { cause?: unknown } | null)?.cause].map(
      (candidate) => (candidate as { code?: unknown } | null)?.code,
    );
    if (code.includes(UNIQUE_VIOLATION)) {
      throw new ConflictException('Two grading periods have the same name.');
    }
    throw error;
  }
}

/** "on 2026-12-22" or "from 2026-10-12 to 2026-10-16", for messages. */
function span(startsOn: string, endsOn: string | null): string {
  return endsOn && endsOn !== startsOn ? `from ${startsOn} to ${endsOn}` : `on ${startsOn}`;
}

/**
 * The academic calendar (wireframe A08) and a class's view of it (T03). Every change locks the
 * term row first, so a change to the term's dates and a new period or event cannot both pass
 * their checks against dates the other is changing.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reading

  async termCalendar(termId: string): Promise<TermCalendar> {
    const term = await this.findTerm(this.db, termId);
    return this.calendarOf(this.db, term);
  }

  /** The calendar as one class sees it: term-wide events plus those for its course. */
  async classCalendar(teacher: UserRow, sectionId: string): Promise<ClassCalendar> {
    const [row] = await this.db
      .select({ term: academicTerms, courseId: classSections.courseId })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .where(
        and(
          eq(teachingAssignments.sectionId, sectionId),
          eq(teachingAssignments.teacherId, teacher.id),
        ),
      );
    // Same answer for "not yours" and "does not exist", so section ids cannot be probed.
    if (!row) throw new NotFoundException('No such class.');
    const [periods, events] = await Promise.all([
      this.periodsOf(this.db, row.term.id),
      this.eventsOf(this.db, row.term.id),
    ]);
    return {
      term: toTerm(row.term),
      gradingPeriods: periods,
      // A class sees term-wide events and its own course's; the other courses an event names are
      // not this teacher's business.
      events: events
        .filter(
          (event) =>
            event.courses.length === 0 ||
            event.courses.some((course) => course.id === row.courseId),
        )
        .map((event) => ({
          ...event,
          courses: event.courses.filter((course) => course.id === row.courseId),
        })),
    };
  }

  // ---------- Changes

  /** Moves the term's start or end; refused while periods or events would fall outside it. */
  async setTermDates(termId: string, dates: TermDates, change: AdminChange): Promise<TermCalendar> {
    return this.change(termId, async (tx, term) => {
      if (term.startsOn === dates.startsOn && term.endsOn === dates.endsOn) return;
      const [periods, events] = await Promise.all([
        this.periodsOf(tx, termId),
        this.eventsOf(tx, termId),
      ]);
      const outside = [
        ...periods.map((period) => ({ ...period, label: `Grading period ${period.name}` })),
        ...events.map((event) => ({
          ...event,
          endsOn: event.endsOn ?? event.startsOn,
          label: `The event "${event.title}"`,
        })),
      ].find((item) => item.startsOn < dates.startsOn || item.endsOn > dates.endsOn);
      if (outside) {
        throw new ConflictException(
          `${outside.label} (${span(outside.startsOn, outside.endsOn)}) would fall outside the term. Move it first.`,
        );
      }
      await tx.update(academicTerms).set(dates).where(eq(academicTerms.id, termId));
      await this.record(
        tx,
        change,
        'term.dates_changed',
        'term',
        termId,
        { startsOn: term.startsOn, endsOn: term.endsOn },
        { ...dates },
      );
    });
  }

  /** Replaces the term's grading periods with this list (already sorted and non-overlapping). */
  async setGradingPeriods(
    termId: string,
    request: GradingPeriodsRequest,
    change: AdminChange,
  ): Promise<TermCalendar> {
    return this.change(termId, async (tx, term) => {
      const outside = request.periods.find(
        (period) => period.startsOn < term.startsOn || period.endsOn > term.endsOn,
      );
      if (outside) {
        throw new ConflictException(
          `${outside.name} must fall within the term (${term.startsOn} to ${term.endsOn}).`,
        );
      }
      const before = await this.periodsOf(tx, termId);
      await tx.delete(gradingPeriods).where(eq(gradingPeriods.termId, termId));
      if (request.periods.length > 0) {
        await uniquely(() =>
          tx.insert(gradingPeriods).values(
            request.periods.map((period, index) => ({
              termId,
              name: period.name,
              position: index + 1,
              startsOn: period.startsOn,
              endsOn: period.endsOn,
            })),
          ),
        );
      }
      await this.record(
        tx,
        change,
        'grading_periods.set',
        'term',
        termId,
        { periods: before.map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })) },
        { periods: request.periods },
      );
    });
  }

  async createEvent(
    termId: string,
    input: CalendarEventInput,
    change: AdminChange,
  ): Promise<TermCalendar> {
    return this.change(termId, async (tx, term) => {
      await this.checkEvent(tx, term, input);
      const [created] = await tx
        .insert(calendarEvents)
        .values({
          termId,
          title: input.title,
          kind: input.kind,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        })
        .returning();
      if (!created) throw new ConflictException('The event could not be added.');
      await this.setEventCourses(tx, created.id, input.courseIds);
      await this.record(tx, change, 'calendar_event.created', 'calendar_event', created.id, null, {
        termId,
        ...input,
      });
    });
  }

  async updateEvent(
    termId: string,
    eventId: string,
    input: CalendarEventInput,
    change: AdminChange,
  ): Promise<TermCalendar> {
    return this.change(termId, async (tx, term) => {
      const before = await this.findEvent(tx, termId, eventId);
      await this.checkEvent(tx, term, input);
      await tx
        .update(calendarEvents)
        .set({
          title: input.title,
          kind: input.kind,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, eventId));
      await this.setEventCourses(tx, eventId, input.courseIds);
      await this.record(
        tx,
        change,
        'calendar_event.updated',
        'calendar_event',
        eventId,
        eventSnapshot(before),
        { ...input },
      );
    });
  }

  async removeEvent(termId: string, eventId: string, change: AdminChange): Promise<TermCalendar> {
    return this.change(termId, async (tx) => {
      const before = await this.findEvent(tx, termId, eventId);
      await tx.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
      await this.record(
        tx,
        change,
        'calendar_event.removed',
        'calendar_event',
        eventId,
        eventSnapshot(before),
        null,
      );
    });
  }

  // ---------- Helpers

  private async change(
    termId: string,
    work: (tx: DbExecutor, term: TermRow) => Promise<void>,
  ): Promise<TermCalendar> {
    return this.db.transaction(async (tx) => {
      const term = await this.findTerm(tx, termId, true);
      await work(tx, term);
      return this.calendarOf(tx, await this.findTerm(tx, termId));
    });
  }

  private async findTerm(executor: DbExecutor, termId: string, lock = false): Promise<TermRow> {
    const query = executor.select().from(academicTerms).where(eq(academicTerms.id, termId));
    const [term] = lock ? await query.for('update') : await query;
    if (!term) throw new NotFoundException('No such term.');
    return term;
  }

  private async findEvent(executor: DbExecutor, termId: string, eventId: string) {
    const event = (await this.eventsOf(executor, termId)).find((item) => item.id === eventId);
    if (!event) throw new NotFoundException('No such event in this term.');
    return event;
  }

  /** Within the term, and limited only to courses offered this term. */
  private async checkEvent(
    executor: DbExecutor,
    term: TermRow,
    input: CalendarEventInput,
  ): Promise<void> {
    const endsOn = input.endsOn ?? input.startsOn;
    if (input.startsOn < term.startsOn || endsOn > term.endsOn) {
      throw new ConflictException(
        `The event must fall within the term (${term.startsOn} to ${term.endsOn}).`,
      );
    }
    if (input.courseIds.length === 0) return;
    const offered = new Set(
      (await this.offeringsOf(executor, term.id)).map((offering) => offering.id),
    );
    if (!input.courseIds.every((id) => offered.has(id))) {
      throw new ConflictException('Choose courses that have a section this term.');
    }
  }

  private async setEventCourses(
    executor: DbExecutor,
    eventId: string,
    courseIds: readonly string[],
  ): Promise<void> {
    await executor.delete(calendarEventCourses).where(eq(calendarEventCourses.eventId, eventId));
    if (courseIds.length === 0) return;
    await executor
      .insert(calendarEventCourses)
      .values(courseIds.map((courseId) => ({ eventId, courseId })));
  }

  private async calendarOf(executor: DbExecutor, term: TermRow): Promise<TermCalendar> {
    const [periods, events, offerings] = await Promise.all([
      this.periodsOf(executor, term.id),
      this.eventsOf(executor, term.id),
      this.offeringsOf(executor, term.id),
    ]);
    return { term: toTerm(term), gradingPeriods: periods, events, offerings };
  }

  private async periodsOf(executor: DbExecutor, termId: string): Promise<GradingPeriod[]> {
    const rows = await executor
      .select()
      .from(gradingPeriods)
      .where(eq(gradingPeriods.termId, termId))
      .orderBy(asc(gradingPeriods.position));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      position: row.position,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
    }));
  }

  private async eventsOf(executor: DbExecutor, termId: string): Promise<CalendarEvent[]> {
    const rows = await executor
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.termId, termId))
      .orderBy(asc(calendarEvents.startsOn), asc(calendarEvents.title));
    if (rows.length === 0) return [];
    const links = await executor
      .select({
        eventId: calendarEventCourses.eventId,
        id: courses.id,
        code: courses.code,
      })
      .from(calendarEventCourses)
      .innerJoin(courses, eq(courses.id, calendarEventCourses.courseId))
      .where(
        inArray(
          calendarEventCourses.eventId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(courses.code));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      courses: links
        .filter((link) => link.eventId === row.id)
        .map(({ id, code }) => ({ id, code })),
    }));
  }

  /** Courses with at least one section this term. */
  private async offeringsOf(executor: DbExecutor, termId: string): Promise<Offering[]> {
    return executor
      .select({
        id: courses.id,
        code: courses.code,
        title: courses.title,
        sections: count(classSections.id),
      })
      .from(classSections)
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(eq(classSections.termId, termId))
      .groupBy(courses.id, courses.code, courses.title)
      .orderBy(asc(courses.code));
  }

  private async record(
    tx: DbExecutor,
    change: AdminChange,
    action: AuditAction,
    targetType: 'term' | 'calendar_event',
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

function eventSnapshot(event: CalendarEvent): Record<string, unknown> {
  return {
    title: event.title,
    kind: event.kind,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    courseIds: event.courses.map((course) => course.id),
  };
}
