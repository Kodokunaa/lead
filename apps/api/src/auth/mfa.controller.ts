import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  mfaDisableRequestSchema,
  mfaEnableRequestSchema,
  mfaVerifyRequestSchema,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type SessionResponse,
} from '@lead/schema';
import type { Request, Response } from 'express';
import type { UserRow } from '../database/schema';
import { CurrentSessionFamily, CurrentUserRow, Public } from './auth.guard';
import { clientInfo, parseBody, SIGN_IN_LIMIT } from './http';
import { MfaService } from './mfa.service';
import { SessionCookies } from './session-cookies';

@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly cookies: SessionCookies,
  ) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@CurrentUserRow() user: UserRow): Promise<MfaSetupResponse> {
    return this.mfa.setup(user);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @CurrentUserRow() user: UserRow,
    @CurrentSessionFamily() family: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<MfaEnableResponse> {
    const input = parseBody(
      mfaEnableRequestSchema,
      body,
      'Enter your password and the 6-digit code.',
    );
    return this.mfa.enable(user, input, family, clientInfo(request));
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(
    @CurrentUserRow() user: UserRow,
    @CurrentSessionFamily() family: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const input = parseBody(
      mfaDisableRequestSchema,
      body,
      'Enter your password and a 6-digit code.',
    );
    await this.mfa.disable(user, input, family, clientInfo(request));
  }

  /** Second sign-in step. Throttled like sign-in, since it is also a guessing target. */
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const verified = parseBody(
      mfaVerifyRequestSchema,
      body,
      'Enter a 6-digit code or a recovery code.',
    );
    const session = await this.mfa.verify(verified, clientInfo(request));
    return this.cookies.start(response, session);
  }
}
