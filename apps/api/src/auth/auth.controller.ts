import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { signInRequestSchema, type CurrentUser, type SessionResponse } from '@lead/schema';
import type { CookieOptions, Request, Response } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { UserRow } from '../database/schema';
import { CurrentUserRow, Public } from './auth.guard';
import { AuthError, AuthService, toCurrentUser, type ClientInfo } from './auth.service';
import { REFRESH_TOKEN_TTL_MS } from './tokens';

export const REFRESH_COOKIE = 'lead_refresh';

/**
 * Per IP. Generous because a whole classroom may share one campus IP; per-account lockout is
 * what stops password guessing. This only blunts floods from a single address.
 */
export const SIGN_IN_LIMIT_PER_MINUTE = 60;
const SIGN_IN_LIMIT = { default: { limit: SIGN_IN_LIMIT_PER_MINUTE, ttl: 60_000 } };
/** Each signed-in user refreshes about every 15 minutes; this only stops floods. */
const REFRESH_LIMIT = { default: { limit: 300, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const parsed = signInRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Enter a valid email and password.');

    const issued = await this.auth.signIn(parsed.data, clientInfo(request));
    response.cookie(REFRESH_COOKIE, issued.refreshToken, this.cookieOptions());
    return issued.response;
  }

  @Public()
  @Throttle(REFRESH_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    this.assertSameOrigin(request);
    const token = refreshCookie(request);
    if (!token) throw new AuthError('session_invalid');

    try {
      const issued = await this.auth.refresh(token, clientInfo(request));
      response.cookie(REFRESH_COOKIE, issued.refreshToken, this.cookieOptions());
      return issued.response;
    } catch (error) {
      // Clear only a dead session's cookie. A superseded request must not wipe the newer
      // cookie another tab just received, and a database error must not sign anyone out.
      if (error instanceof AuthError && error.code === 'session_invalid') {
        response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
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
    this.assertSameOrigin(request);
    const token = refreshCookie(request);
    if (token) await this.auth.signOut(token, clientInfo(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  me(@CurrentUserRow() user: UserRow): CurrentUser {
    return toCurrentUser(user);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    };
  }

  /**
   * Cookie-authenticated endpoints refuse other sites (CSRF). SameSite=Strict already blocks
   * this in current browsers; the Origin check covers older ones.
   */
  private assertSameOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (origin && origin !== this.env.WEB_ORIGIN) {
      throw new ForbiddenException('Cross-site request refused.');
    }
  }
}

function refreshCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function clientInfo(request: Request): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}
