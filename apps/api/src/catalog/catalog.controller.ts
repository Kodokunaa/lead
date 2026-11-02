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
  Query,
  Req,
} from '@nestjs/common';
import {
  courseArchiveSchema,
  courseInputSchema,
  courseListQuerySchema,
  courseUpdateSchema,
  programInputSchema,
  programUpdateSchema,
  termInputSchema,
  type Course,
  type CourseListResponse,
  type CourseRecord,
  type Program,
  type Term,
} from '@lead/schema';
import type { Request } from 'express';
import type { AdminChange } from '../admin/admin-users.service';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { CatalogService } from './catalog.service';
import { CourseRecordService } from './course-record.service';

const id = new ParseUUIDPipe({ version: '4' });

function change(admin: UserRow, request: Request, reason: string | null = null): AdminChange {
  return { admin, client: clientInfo(request), reason };
}

/** Programs, academic terms and courses (wireframe A05). Administrators only. */
@Roles('admin')
@Controller('admin')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly records: CourseRecordService,
  ) {}

  @Get('programs')
  listPrograms(): Promise<Program[]> {
    return this.catalog.listPrograms();
  }

  @Post('programs')
  createProgram(
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Program> {
    const input = parseBody(programInputSchema, body, 'Enter a program code and name.');
    return this.catalog.createProgram(input, change(admin, request));
  }

  @Patch('programs/:id')
  updateProgram(
    @Param('id', id) programId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Program> {
    const input = parseBody(programUpdateSchema, body, 'Check the program name.');
    return this.catalog.updateProgram(programId, input, change(admin, request));
  }

  @Get('terms')
  listTerms(): Promise<Term[]> {
    return this.catalog.listTerms();
  }

  @Post('terms')
  createTerm(
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Term> {
    const input = parseBody(
      termInputSchema,
      body,
      'Enter the school year (e.g. 2026-2027), the semester, and start and end dates in order.',
    );
    return this.catalog.createTerm(input, change(admin, request));
  }

  @Post('terms/:id/make-current')
  @HttpCode(HttpStatus.OK)
  makeCurrent(
    @Param('id', id) termId: string,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Term> {
    return this.catalog.makeCurrent(termId, change(admin, request));
  }

  @Get('courses')
  listCourses(@Query() query: unknown): Promise<CourseListResponse> {
    return this.catalog.listCourses(parseBody(courseListQuerySchema, query, 'Check the filters.'));
  }

  /** A06 Course offering and curriculum record. */
  @Get('courses/:id/record')
  courseRecord(@Param('id', id) courseId: string): Promise<CourseRecord> {
    return this.records.record(courseId);
  }

  @Post('courses')
  createCourse(
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Course> {
    const input = parseBody(
      courseInputSchema,
      body,
      'Enter a course code (e.g. IS 301), a title and 1 to 6 units.',
    );
    return this.catalog.createCourse(input, change(admin, request));
  }

  @Patch('courses/:id')
  updateCourse(
    @Param('id', id) courseId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Course> {
    const input = parseBody(courseUpdateSchema, body, 'Check the course details.');
    return this.catalog.updateCourse(courseId, input, change(admin, request));
  }

  @Post('courses/:id/archive')
  @HttpCode(HttpStatus.OK)
  archiveCourse(
    @Param('id', id) courseId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Course> {
    const { reason } = parseBody(
      courseArchiveSchema,
      body,
      'Give a reason of at least 3 characters.',
    );
    return this.catalog.archiveCourse(courseId, change(admin, request, reason));
  }

  @Post('courses/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreCourse(
    @Param('id', id) courseId: string,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<Course> {
    return this.catalog.restoreCourse(courseId, change(admin, request));
  }
}
