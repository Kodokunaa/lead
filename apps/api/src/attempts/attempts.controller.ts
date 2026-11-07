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
} from '@nestjs/common';
import {
  answerInputSchema,
  type AnswerSaved,
  type AttemptResult,
  type AttemptView,
  type StudentAssessmentDetails,
  type StudentAssessmentSummary,
} from '@lead/schema';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody, parseBodyExplained } from '../auth/http';
import type { UserRow } from '../database/schema';
import { AttemptsService, type Taker } from './attempts.service';

const id = new ParseUUIDPipe({ version: '4' });
const sectionFilter = z.uuid().optional();

function taker(student: UserRow, request: Request): Taker {
  return { student, client: clientInfo(request) };
}

/** S07–S11 quizzes and examinations, for students enrolled in the class. */
@Roles('student')
@Controller('student')
export class StudentAttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get('assessments')
  list(
    @Query('section') section: unknown,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentAssessmentSummary[]> {
    const sectionId = parseBody(sectionFilter, section || undefined, 'Choose a class.');
    return this.attempts.list(student, sectionId);
  }

  @Get('assessments/:assessmentId')
  details(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<StudentAssessmentDetails> {
    return this.attempts.details(student, assessmentId);
  }

  /** Begins an attempt, or reopens the one in progress. */
  @Post('assessments/:assessmentId/attempts')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('assessmentId', id) assessmentId: string,
    @CurrentUserRow() student: UserRow,
    @Req() request: Request,
  ): Promise<AttemptView> {
    return this.attempts.start(assessmentId, taker(student, request));
  }

  @Get('attempts/:attemptId')
  attempt(
    @Param('attemptId', id) attemptId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<AttemptView> {
    return this.attempts.attempt(student, attemptId);
  }

  @Put('attempts/:attemptId/answers/:questionId')
  saveAnswer(
    @Param('attemptId', id) attemptId: string,
    @Param('questionId', id) questionId: string,
    @Body() body: unknown,
    @CurrentUserRow() student: UserRow,
    @Req() request: Request,
  ): Promise<AnswerSaved> {
    const input = parseBodyExplained(answerInputSchema, body, 'Check your answer.');
    return this.attempts.saveAnswer(attemptId, questionId, input, taker(student, request));
  }

  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('attemptId', id) attemptId: string,
    @CurrentUserRow() student: UserRow,
    @Req() request: Request,
  ): Promise<AttemptResult> {
    return this.attempts.submitAttempt(attemptId, taker(student, request));
  }

  @Get('attempts/:attemptId/result')
  result(
    @Param('attemptId', id) attemptId: string,
    @CurrentUserRow() student: UserRow,
  ): Promise<AttemptResult> {
    return this.attempts.attemptResult(student, attemptId);
  }
}
