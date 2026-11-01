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
  assignTeacherSchema,
  dropRequestSchema,
  enrollRequestSchema,
  sectionInputSchema,
  sectionListQuerySchema,
  sectionUpdateSchema,
  type EnrollResult,
  type SectionDetails,
  type SectionListResponse,
  type SectionSummary,
  type StudentClass,
} from '@lead/schema';
import type { Request } from 'express';
import { z } from 'zod';
import type { AdminChange } from '../admin/admin-users.service';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { SectionsService } from './sections.service';

const id = new ParseUUIDPipe({ version: '4' });
const termQuerySchema = z.object({ term: z.uuid().optional() });

function change(admin: UserRow, request: Request, reason: string | null = null): AdminChange {
  return { admin, client: clientInfo(request), reason };
}

/** A07 Section Management. Administrators only. */
@Roles('admin')
@Controller('admin/sections')
export class AdminSectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  list(@Query() query: unknown): Promise<SectionListResponse> {
    return this.sections.list(parseBody(sectionListQuerySchema, query, 'Check the filters.'));
  }

  @Get(':id')
  details(@Param('id', id) sectionId: string): Promise<SectionDetails> {
    return this.sections.details(sectionId);
  }

  @Post()
  create(
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<SectionSummary> {
    const input = parseBody(
      sectionInputSchema,
      body,
      'Enter a course code, a term, a section name (e.g. BSIS 3-A) and a capacity of 1 to 200.',
    );
    return this.sections.create(input, change(admin, request));
  }

  @Patch(':id')
  update(
    @Param('id', id) sectionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<SectionSummary> {
    const input = parseBody(sectionUpdateSchema, body, 'Check the section name and capacity.');
    return this.sections.update(sectionId, input, change(admin, request));
  }

  @Post(':id/teachers')
  @HttpCode(HttpStatus.OK)
  assignTeacher(
    @Param('id', id) sectionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<SectionDetails> {
    const { email } = parseBody(assignTeacherSchema, body, "Enter the teacher's email.");
    return this.sections.assignTeacher(sectionId, email, change(admin, request));
  }

  @Post(':id/teachers/:teacherId/remove')
  @HttpCode(HttpStatus.OK)
  unassignTeacher(
    @Param('id', id) sectionId: string,
    @Param('teacherId', id) teacherId: string,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<SectionDetails> {
    return this.sections.unassignTeacher(sectionId, teacherId, change(admin, request));
  }

  @Post(':id/enrollments')
  @HttpCode(HttpStatus.OK)
  enroll(
    @Param('id', id) sectionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<EnrollResult> {
    const { emails } = parseBody(
      enrollRequestSchema,
      body,
      'Enter up to 100 student emails, separated by commas or new lines.',
    );
    return this.sections.enroll(sectionId, emails, change(admin, request));
  }

  @Post(':id/enrollments/:studentId/drop')
  @HttpCode(HttpStatus.OK)
  drop(
    @Param('id', id) sectionId: string,
    @Param('studentId', id) studentId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<SectionDetails> {
    const { reason } = parseBody(
      dropRequestSchema,
      body,
      'Give a reason of at least 3 characters.',
    );
    return this.sections.drop(sectionId, studentId, change(admin, request, reason));
  }
}

/** T02 My Classes: the signed-in teacher's own sections. */
@Roles('teacher')
@Controller('teacher/classes')
export class TeacherClassesController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  list(@CurrentUserRow() teacher: UserRow, @Query() query: unknown): Promise<SectionSummary[]> {
    const { term } = parseBody(termQuerySchema, query, 'Check the term.');
    return this.sections.teacherClasses(teacher, term);
  }

  @Get(':id')
  details(
    @CurrentUserRow() teacher: UserRow,
    @Param('id', id) sectionId: string,
  ): Promise<SectionDetails> {
    return this.sections.teacherClass(teacher, sectionId);
  }
}

/** S02 My Courses: the signed-in student's enrolled classes. */
@Roles('student')
@Controller('student/classes')
export class StudentClassesController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  list(@CurrentUserRow() student: UserRow): Promise<StudentClass[]> {
    return this.sections.studentClasses(student);
  }
}
