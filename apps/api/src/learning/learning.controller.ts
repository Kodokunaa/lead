import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import type { StudentClassOverview, StudentLesson, StudentResourceView } from '@lead/schema';
import type { Response } from 'express';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import type { UserRow } from '../database/schema';
import { sendFile } from '../resources/resources.controller';
import { LearningService } from './learning.service';

const id = new ParseUUIDPipe({ version: '4' });

/** S03, S05, S06: a class as its enrolled students see it. */
@Roles('student')
@Controller('student/classes/:sectionId')
export class StudentLearningController {
  constructor(private readonly learning: LearningService) {}

  @Get()
  overview(
    @Param('sectionId', id) sectionId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentClassOverview> {
    return this.learning.overview(student, sectionId);
  }

  @Get('lessons/:lessonId')
  lesson(
    @Param('sectionId', id) sectionId: string,
    @Param('lessonId', id) lessonId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentLesson> {
    return this.learning.lesson(student, sectionId, lessonId);
  }

  @Get('resources/:resourceId')
  resource(
    @Param('sectionId', id) sectionId: string,
    @Param('resourceId', id) resourceId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentResourceView> {
    return this.learning.resource(student, sectionId, resourceId);
  }

  @Get('resources/:resourceId/file')
  async file(
    @Param('sectionId', id) sectionId: string,
    @Param('resourceId', id) resourceId: string,
    @CurrentUserRow() student: UserRow,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendFile(await this.learning.resourceFile(student, sectionId, resourceId), response);
  }
}
