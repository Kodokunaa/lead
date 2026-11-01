import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  calendarEventInputSchema,
  gradingPeriodsRequestSchema,
  termDatesSchema,
  type ClassCalendar,
  type TermCalendar,
} from '@lead/schema';
import type { Request } from 'express';
import type { AdminChange } from '../admin/admin-users.service';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { CalendarService } from './calendar.service';

const id = new ParseUUIDPipe({ version: '4' });

function change(admin: UserRow, request: Request): AdminChange {
  return { admin, client: clientInfo(request), reason: null };
}

/** A08 Programs, terms and academic calendar. Administrators only. */
@Roles('admin')
@Controller('admin/terms/:termId')
export class AdminCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar')
  termCalendar(@Param('termId', id) termId: string): Promise<TermCalendar> {
    return this.calendar.termCalendar(termId);
  }

  @Patch()
  setDates(
    @Param('termId', id) termId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<TermCalendar> {
    const dates = parseBody(termDatesSchema, body, 'Enter a start and an end date for the term.');
    return this.calendar.setTermDates(termId, dates, change(admin, request));
  }

  @Put('grading-periods')
  setGradingPeriods(
    @Param('termId', id) termId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<TermCalendar> {
    const periods = parseBody(gradingPeriodsRequestSchema, body, 'Check the grading periods.');
    return this.calendar.setGradingPeriods(termId, periods, change(admin, request));
  }

  @Post('events')
  createEvent(
    @Param('termId', id) termId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<TermCalendar> {
    const input = parseBody(calendarEventInputSchema, body, 'Check the event details.');
    return this.calendar.createEvent(termId, input, change(admin, request));
  }

  @Put('events/:eventId')
  updateEvent(
    @Param('termId', id) termId: string,
    @Param('eventId', id) eventId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<TermCalendar> {
    const input = parseBody(calendarEventInputSchema, body, 'Check the event details.');
    return this.calendar.updateEvent(termId, eventId, input, change(admin, request));
  }

  @Post('events/:eventId/remove')
  @HttpCode(HttpStatus.OK)
  removeEvent(
    @Param('termId', id) termId: string,
    @Param('eventId', id) eventId: string,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<TermCalendar> {
    return this.calendar.removeEvent(termId, eventId, change(admin, request));
  }
}

/** T03 class overview: the calendar as one of the teacher's classes sees it. */
@Roles('teacher')
@Controller('teacher/classes')
export class TeacherCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':id/calendar')
  classCalendar(
    @Param('id', id) sectionId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<ClassCalendar> {
    return this.calendar.classCalendar(teacher, sectionId);
  }
}
