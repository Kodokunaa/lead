import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  gradeInputSchema,
  submissionConfirmSchema,
  submissionDraftSchema,
  type GradingQueue,
  type GradingView,
  type StudentAssignment,
} from '@lead/schema';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody, parseBodyExplained } from '../auth/http';
import type { UserRow } from '../database/schema';
import type { UploadedResourceFile } from '../resources/resource-files';
import { sendFile, upload } from '../resources/resources.controller';
import { GradingService } from './grading.service';
import { SubmissionsService } from './submissions.service';

const id = new ParseUUIDPipe({ version: '4' });

/**
 * A classroom shares one address (NAT) and hands work in near the due time, so student uploads
 * get their own limit, well above the teachers' UPLOADS_PER_MINUTE.
 */
const STUDENT_UPLOAD_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const queueFilter = z.object({
  section: z.uuid().optional(),
  status: z.enum(['needs_review', 'draft_grade', 'released', 'missing']).optional(),
});

/** S12 assignment and project submissions, for students enrolled in the class. */
@Roles('student')
@Controller('student')
export class StudentSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('assignments/:assessmentId')
  assignment(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentAssignment> {
    return this.submissions.assignment(student, assessmentId);
  }

  /** Uploads (or replaces) the draft: multipart `file` and an optional `note`. */
  @Post('assignments/:assessmentId/draft')
  @HttpCode(HttpStatus.OK)
  @Throttle(STUDENT_UPLOAD_LIMIT)
  @UseInterceptors(upload)
  saveDraft(
    @Param('assessmentId', id) assessmentId: string,
    @UploadedFile() file: UploadedResourceFile | undefined,
    @Body() body: unknown,
    @CurrentUserRow() student: UserRow,
    @Req() request: Request,
  ): Promise<StudentAssignment> {
    const { note } = parseBodyExplained(submissionDraftSchema, body ?? {}, 'Check the note.');
    return this.submissions.saveDraft(assessmentId, file, note, {
      student,
      client: clientInfo(request),
    });
  }

  @Post('assignments/:assessmentId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('assessmentId', id) assessmentId: string,
    @Body() body: unknown,
    @CurrentUserRow() student: UserRow,
    @Req() request: Request,
  ): Promise<StudentAssignment> {
    parseBodyExplained(
      submissionConfirmSchema,
      body,
      'Confirm that this is the file you intend to submit.',
    );
    return this.submissions.submit(assessmentId, { student, client: clientInfo(request) });
  }

  @Get('submissions/:submissionId/file')
  async file(
    @Param('submissionId', id) submissionId: string,
    @CurrentUserRow() student: UserRow,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendFile(await this.submissions.file(student, submissionId), response);
  }
}

/** T13–T14 grading of assignments and projects. Teachers of the class this term. */
@Roles('teacher')
@Controller('teacher/grading')
export class TeacherGradingController {
  constructor(private readonly grading: GradingService) {}

  @Get()
  queue(@Query() query: unknown, @CurrentUserRow() teacher: UserRow): Promise<GradingQueue> {
    const { section, status } = parseBody(queueFilter, query, 'Check the filters.');
    return this.grading.queue(teacher, section, status);
  }

  @Get(':assessmentId/students/:studentId')
  view(
    @Param('assessmentId', id) assessmentId: string,
    @Param('studentId', id) studentId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<GradingView> {
    return this.grading.view(teacher, assessmentId, studentId);
  }

  @Put(':assessmentId/students/:studentId')
  saveGrade(
    @Param('assessmentId', id) assessmentId: string,
    @Param('studentId', id) studentId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<GradingView> {
    const input = parseBodyExplained(gradeInputSchema, body, 'Check the grade.');
    return this.grading.saveGrade(assessmentId, studentId, input, {
      teacher,
      client: clientInfo(request),
    });
  }

  @Get(':assessmentId/submissions/:submissionId/file')
  async file(
    @Param('assessmentId', id) assessmentId: string,
    @Param('submissionId', id) submissionId: string,
    @CurrentUserRow() teacher: UserRow,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendFile(await this.grading.file(teacher, assessmentId, submissionId), response);
  }
}
