import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  signInRequestSchema,
  type CurrentUser,
  type SessionResponse,
  type SignInResponse,
} from '@lead/schema';
import type { Request, Response } from 'express';
import type { UserRow } from '../database/schema';
import { CurrentUserRow, Public } from './auth.guard';
import { AuthError, AuthService, toCurrentUser } from './auth.service';
import { clientInfo, parseBody, REFRESH_LIMIT, SIGN_IN_LIMIT } from './http';
import { SessionCookies } from './session-cookies';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResponse> {
    const credentials = parseBody(signInRequestSchema, body, 'Enter a valid email and password.');
    const outcome = await this.auth.signIn(credentials, clientInfo(request));
    if (outcome.kind === 'mfa') return outcome.challenge;
    return this.cookies.start(response, outcome.session);
  }

  @Public()
  @Throttle(REFRESH_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    this.cookies.assertSameOrigin(request);
    const token = this.cookies.read(request);
    if (!token) throw new AuthError('session_invalid');

    try {
      return this.cookies.start(response, await this.auth.refresh(token, clientInfo(request)));
    } catch (error) {
      // Clear only a dead session's cookie. A superseded request must not wipe the newer
      // cookie another tab just received, and a database error must not sign anyone out.
      if (error instanceof AuthError && error.code === 'session_invalid') {
        this.cookies.clear(response);
      }
      throw error;
    }
  }

  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.cookies.assertSameOrigin(request);
    const token = this.cookies.read(request);
    if (token) await this.auth.signOut(token, clientInfo(request));
    this.cookies.clear(response);
  }

  @Get('me')
  me(@CurrentUserRow() user: UserRow): CurrentUser {
    return toCurrentUser(user);
  }
}
