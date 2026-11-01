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
} from '@nestjs/common';
import {
  mfaResetRequestSchema,
  reasonRequestSchema,
  roleChangeRequestSchema,
  userListQuerySchema,
  type UserDetails,
  type UserListResponse,
  type UserSummary,
} from '@lead/schema';
import type { Request } from 'express';
import { CurrentUserRow, Roles } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { AdminUsersService, type AdminChange } from './admin-users.service';

const REASON_HINT = 'Give a reason of at least 3 characters.';
const userId = new ParseUUIDPipe({ version: '4' });

@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: unknown): Promise<UserListResponse> {
    return this.users.list(parseBody(userListQuerySchema, query, 'Check the search filters.'));
  }

  @Get(':id')
  details(@Param('id', userId) id: string): Promise<UserDetails> {
    return this.users.details(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Req() request: Request,
  ): Promise<UserSummary> {
    return this.users.approve(id, { admin, client: clientInfo(request), reason: null });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<UserSummary> {
    return this.users.reject(id, withReason(admin, body, request));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<UserSummary> {
    return this.users.deactivate(id, withReason(admin, body, request));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<UserSummary> {
    return this.users.reactivate(id, withReason(admin, body, request));
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.OK)
  changeRole(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<UserSummary> {
    const { role, reason } = parseBody(
      roleChangeRequestSchema,
      body,
      `Choose a role. ${REASON_HINT}`,
    );
    return this.users.changeRole(id, role, { admin, client: clientInfo(request), reason });
  }

  @Post(':id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  resetMfa(
    @Param('id', userId) id: string,
    @CurrentUserRow() admin: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<UserSummary> {
    const { reason, password } = parseBody(
      mfaResetRequestSchema,
      body,
      `Enter your own password. ${REASON_HINT}`,
    );
    return this.users.resetMfa(id, password, { admin, client: clientInfo(request), reason });
  }
}

function withReason(admin: UserRow, body: unknown, request: Request): AdminChange {
  const { reason } = parseBody(reasonRequestSchema, body, REASON_HINT);
  return { admin, client: clientInfo(request), reason };
}
