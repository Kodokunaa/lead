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
  Query,
  Req,
} from '@nestjs/common';
import {
  assessmentCreateSchema,
  assessmentSettingsSchema,
  questionInputSchema,
  questionMoveSchema,
  rubricInputSchema,
  type AssessmentDetails,
  type AssessmentList,
} from '@lead/schema';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody, parseBodyExplained } from '../auth/http';
import type { UserRow } from '../database/schema';
import { AssessmentsService, type AssessmentEditor } from './assessments.service';

const id = new ParseUUIDPipe({ version: '4' });
const sectionFilter = z.uuid().optional();

function editor(teacher: UserRow, request: Request): AssessmentEditor {
  return { teacher, client: clientInfo(request) };
}

/** T08–T12 assessment builder. Teachers of the class this term only. */
@Roles('teacher')
@Controller('teacher/assessments')
export class TeacherAssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get()
  list(
    @Query('section') section: unknown,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<AssessmentList> {
    const sectionId = parseBody(sectionFilter, section || undefined, 'Choose a class.');
    return this.assessments.list(teacher, sectionId);
  }

  @Post()
  create(
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const input = parseBodyExplained(
      assessmentCreateSchema,
      body,
      'Choose a class, type and title.',
    );
    return this.assessments.create(input, editor(teacher, request));
  }

  @Get(':assessmentId')
  details(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<AssessmentDetails> {
    return this.assessments.details(teacher, assessmentId);
  }

  @Patch(':assessmentId')
  updateSettings(
    @Param('assessmentId', id) assessmentId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const input = parseBodyExplained(
      assessmentSettingsSchema,
      body,
      'Check the assessment settings.',
    );
    return this.assessments.updateSettings(assessmentId, input, editor(teacher, request));
  }

  @Post(':assessmentId/questions')
  addQuestion(
    @Param('assessmentId', id) assessmentId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const input = parseBodyExplained(questionInputSchema, body, 'Check the question.');
    return this.assessments.addQuestion(assessmentId, input, editor(teacher, request));
  }

  @Put(':assessmentId/questions/:questionId')
  updateQuestion(
    @Param('assessmentId', id) assessmentId: string,
    @Param('questionId', id) questionId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const input = parseBodyExplained(questionInputSchema, body, 'Check the question.');
    return this.assessments.updateQuestion(
      assessmentId,
      questionId,
      input,
      editor(teacher, request),
    );
  }

  @Post(':assessmentId/questions/:questionId/move')
  @HttpCode(HttpStatus.OK)
  moveQuestion(
    @Param('assessmentId', id) assessmentId: string,
    @Param('questionId', id) questionId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const { direction } = parseBody(questionMoveSchema, body, 'Choose up or down.');
    return this.assessments.moveQuestion(
      assessmentId,
      questionId,
      direction,
      editor(teacher, request),
    );
  }

  @Post(':assessmentId/questions/:questionId/remove')
  @HttpCode(HttpStatus.OK)
  removeQuestion(
    @Param('assessmentId', id) assessmentId: string,
    @Param('questionId', id) questionId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    return this.assessments.removeQuestion(assessmentId, questionId, editor(teacher, request));
  }

  @Put(':assessmentId/rubric')
  saveRubric(
    @Param('assessmentId', id) assessmentId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    const input = parseBodyExplained(rubricInputSchema, body, 'Check the rubric.');
    return this.assessments.saveRubric(assessmentId, input, editor(teacher, request));
  }

  @Post(':assessmentId/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    return this.assessments.publish(assessmentId, editor(teacher, request));
  }

  @Post(':assessmentId/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<AssessmentDetails> {
    return this.assessments.unpublish(assessmentId, editor(teacher, request));
  }
}
