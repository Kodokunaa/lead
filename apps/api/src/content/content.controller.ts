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
  Req,
} from '@nestjs/common';
import {
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  moveRequestSchema,
  objectiveInputSchema,
  type CourseContent,
  type Lesson,
  type TeacherCourse,
} from '@lead/schema';
import type { Request } from 'express';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { ContentService, type ContentEditor } from './content.service';

const id = new ParseUUIDPipe({ version: '4' });

function editor(teacher: UserRow, request: Request): ContentEditor {
  return { teacher, client: clientInfo(request) };
}

/** T04–T06 course content. Teachers of a current-term section of the course only. */
@Roles('teacher')
@Controller('teacher/content')
export class TeacherContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  courses(@CurrentUserRow() teacher: UserRow): Promise<TeacherCourse[]> {
    return this.content.courses(teacher);
  }

  @Get(':courseId')
  outline(
    @Param('courseId', id) courseId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<CourseContent> {
    return this.content.content(teacher, courseId);
  }

  @Post(':courseId/objectives')
  createObjective(
    @Param('courseId', id) courseId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    const input = parseBody(objectiveInputSchema, body, 'Describe the learning objective.');
    return this.content.createObjective(courseId, input, editor(teacher, request));
  }

  @Patch(':courseId/objectives/:objectiveId')
  updateObjective(
    @Param('courseId', id) courseId: string,
    @Param('objectiveId', id) objectiveId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    const input = parseBody(objectiveInputSchema, body, 'Describe the learning objective.');
    return this.content.updateObjective(courseId, objectiveId, input, editor(teacher, request));
  }

  @Post(':courseId/modules')
  createModule(
    @Param('courseId', id) courseId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    const input = parseBody(moduleInputSchema, body, 'Check the module details.');
    return this.content.createModule(courseId, input, editor(teacher, request));
  }

  @Patch(':courseId/modules/:moduleId')
  updateModule(
    @Param('courseId', id) courseId: string,
    @Param('moduleId', id) moduleId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    const update = parseBody(moduleUpdateSchema, body, 'Check the module details.');
    return this.content.updateModule(courseId, moduleId, update, editor(teacher, request));
  }

  @Post(':courseId/modules/:moduleId/move')
  @HttpCode(HttpStatus.OK)
  moveModule(
    @Param('courseId', id) courseId: string,
    @Param('moduleId', id) moduleId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    const move = parseBody(moveRequestSchema, body, 'Move the module up or down.');
    return this.content.moveModule(courseId, moduleId, move, editor(teacher, request));
  }

  @Post(':courseId/modules/:moduleId/publish')
  @HttpCode(HttpStatus.OK)
  publishModule(
    @Param('courseId', id) courseId: string,
    @Param('moduleId', id) moduleId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    return this.content.setModuleStatus(courseId, moduleId, 'published', editor(teacher, request));
  }

  @Post(':courseId/modules/:moduleId/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublishModule(
    @Param('courseId', id) courseId: string,
    @Param('moduleId', id) moduleId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<CourseContent> {
    return this.content.setModuleStatus(courseId, moduleId, 'draft', editor(teacher, request));
  }

  @Post(':courseId/modules/:moduleId/lessons')
  createLesson(
    @Param('courseId', id) courseId: string,
    @Param('moduleId', id) moduleId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<Lesson> {
    const input = parseBody(lessonInputSchema, body, 'Check the lesson details.');
    return this.content.createLesson(courseId, moduleId, input, editor(teacher, request));
  }

  @Get(':courseId/lessons/:lessonId')
  lesson(
    @Param('courseId', id) courseId: string,
    @Param('lessonId', id) lessonId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<Lesson> {
    return this.content.lesson(teacher, courseId, lessonId);
  }

  @Patch(':courseId/lessons/:lessonId')
  updateLesson(
    @Param('courseId', id) courseId: string,
    @Param('lessonId', id) lessonId: string,
    @Body() body: unknown,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<Lesson> {
    const update = parseBody(lessonUpdateSchema, body, 'Check the lesson details.');
    return this.content.updateLesson(courseId, lessonId, update, editor(teacher, request));
  }

  @Post(':courseId/lessons/:lessonId/publish')
  @HttpCode(HttpStatus.OK)
  publishLesson(
    @Param('courseId', id) courseId: string,
    @Param('lessonId', id) lessonId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<Lesson> {
    return this.content.setLessonStatus(courseId, lessonId, 'published', editor(teacher, request));
  }

  @Post(':courseId/lessons/:lessonId/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublishLesson(
    @Param('courseId', id) courseId: string,
    @Param('lessonId', id) lessonId: string,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<Lesson> {
    return this.content.setLessonStatus(courseId, lessonId, 'draft', editor(teacher, request));
  }
}
