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
  passwordChangeSchema,
  profileUpdateSchema,
  type CurrentUser,
  type SessionSummary,
} from '@lead/schema';
import type { Request } from 'express';
import { CurrentSessionFamily, CurrentUserRow } from '../auth/auth.guard';
import { clientInfo, parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('sessions')
  sessions(
    @CurrentUserRow() user: UserRow,
    @CurrentSessionFamily() family: string,
  ): Promise<SessionSummary[]> {
    return this.me.sessions(user, family);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUserRow() user: UserRow,
    @Param('id', new ParseUUIDPipe({ version: '4' })) familyId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.me.revokeSession(user, familyId, clientInfo(request));
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(
    @CurrentUserRow() user: UserRow,
    @CurrentSessionFamily() family: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.me.revokeOtherSessions(user, family, clientInfo(request));
  }

  @Patch('profile')
  updateProfile(
    @CurrentUserRow() user: UserRow,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CurrentUser> {
    const { displayName } = parseBody(
      profileUpdateSchema,
      body,
      'Enter a name of at least 2 characters.',
    );
    return this.me.updateProfile(user, displayName, clientInfo(request));
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUserRow() user: UserRow,
    @CurrentSessionFamily() family: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const change = parseBody(
      passwordChangeSchema,
      body,
      'Enter your current password and a new one of at least 12 characters.',
    );
    await this.me.changePassword(user, change, family, clientInfo(request));
  }
}
