import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  approveRequestSchema,
  MAX_RESOURCE_BYTES,
  resourceInputSchema,
  resourceListQuerySchema,
  returnRequestSchema,
  versionInputSchema,
  withdrawRequestSchema,
  type ResourceDetails,
  type ResourceListResponse,
  type ResourceSummary,
} from '@lead/schema';
import type { Request, Response } from 'express';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { loadEnv } from '../config/env';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import type { UploadedResourceFile } from './resource-files';
import { ResourcesService, type OpenedFile, type ResourceActor } from './resources.service';

const id = new ParseUUIDPipe({ version: '4' });

/**
 * One file per request, kept in memory (multer's default) up to the size limit. File names are
 * read as UTF-8 (multer's default is Latin-1, which garbles names like "Pagsusulit ñ.pdf").
 */
const upload = FileInterceptor('file', {
  limits: { fileSize: MAX_RESOURCE_BYTES, files: 1, fields: 30, parts: 32 },
  defParamCharset: 'utf8',
});

/**
 * Uploads are held in memory while checked, so each address gets only a few a minute
 * (UPLOADS_PER_MINUTE, validated with the rest of the environment at startup).
 */
const UPLOAD_LIMIT = {
  default: { limit: () => loadEnv(process.env).UPLOADS_PER_MINUTE, ttl: 60_000 },
};

/** RFC 5987 value: encodeURIComponent leaves ' ( ) * as they are, which the RFC does not allow. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function actor(user: UserRow, request: Request, reason: string | null = null): ResourceActor {
  return { user, client: clientInfo(request), reason };
}

/**
 * Sends a stored file as a download: never shown inline, never sniffed as another type, never
 * cached, with the name made safe for the header.
 */
export function sendFile(file: OpenedFile, response: Response): StreamableFile {
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  response.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(file.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(file.stream, { length: file.sizeBytes });
}

/** T07 Course resource upload and access. Teachers of a current-term section of the course. */
@Roles('teacher')
@Controller('teacher/content/:courseId/resources')
export class TeacherResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  list(
    @Param('courseId', id) courseId: string,
    @CurrentUserRow() teacher: UserRow,
  ): Promise<ResourceSummary[]> {
    return this.resources.teacherList(teacher, courseId);
  }

  @Post()
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(upload)
  submit(
    @Param('courseId', id) courseId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedResourceFile | undefined,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<ResourceDetails> {
    const input = parseBody(resourceInputSchema, body, 'Check the resource details.');
    return this.resources.submit(courseId, input, file, actor(teacher, request));
  }

  @Post(':resourceId/versions')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(upload)
  addVersion(
    @Param('courseId', id) courseId: string,
    @Param('resourceId', id) resourceId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedResourceFile | undefined,
    @CurrentUserRow() teacher: UserRow,
    @Req() request: Request,
  ): Promise<ResourceDetails> {
    const input = parseBody(versionInputSchema, body, 'Upload a file or give a link.');
    return this.resources.addVersion(courseId, resourceId, input, file, actor(teacher, request));
  }

  @Get(':resourceId/versions/:versionId/file')
  async file(
    @Param('courseId', id) courseId: string,
    @Param('resourceId', id) resourceId: string,
    @Param('versionId', id) versionId: string,
    @CurrentUserRow() teacher: UserRow,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendFile(
      await this.resources.teacherFile(teacher, courseId, resourceId, versionId),
      response,
    );
  }
}

/** A10 resource library and A11 approval. Administrators only. */
@Roles('admin')
@Controller('admin/resources')
export class AdminResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  list(@Query() query: unknown): Promise<ResourceListResponse> {
    return this.resources.adminList(
      parseBody(resourceListQuerySchema, query, 'Check the filters.'),
    );
  }

  @Get(':resourceId')
  details(@Param('resourceId', id) resourceId: string): Promise<ResourceDetails> {
    return this.resources.adminDetails(resourceId);
  }

  @Post(':resourceId/versions/:versionId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('resourceId', id) resourceId: string,
    @Param('versionId', id) versionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<ResourceDetails> {
    const approval = parseBody(approveRequestSchema, body, 'Confirm both checks to approve.');
    return this.resources.approve(resourceId, versionId, approval, actor(admin, request));
  }

  @Post(':resourceId/versions/:versionId/return')
  @HttpCode(HttpStatus.OK)
  returnForRevision(
    @Param('resourceId', id) resourceId: string,
    @Param('versionId', id) versionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<ResourceDetails> {
    const returned = parseBody(returnRequestSchema, body, 'Tell the teacher what to change.');
    return this.resources.returnForRevision(resourceId, versionId, returned, actor(admin, request));
  }

  @Post(':resourceId/versions/:versionId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @Param('resourceId', id) resourceId: string,
    @Param('versionId', id) versionId: string,
    @Body() body: unknown,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<ResourceDetails> {
    const { reason } = parseBody(withdrawRequestSchema, body, 'Give a reason for withdrawing.');
    return this.resources.withdraw(resourceId, versionId, actor(admin, request, reason));
  }

  @Get(':resourceId/versions/:versionId/file')
  async file(
    @Param('resourceId', id) resourceId: string,
    @Param('versionId', id) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendFile(await this.resources.adminFile(resourceId, versionId), response);
  }
}
