import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { SessionResponse } from '@lead/schema';
import type { CookieOptions, Request, Response } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { IssuedSession } from './auth.service';
import { REFRESH_TOKEN_TTL_MS } from './tokens';

export const REFRESH_COOKIE = 'lead_refresh';

/** The refresh-token cookie, shared by every endpoint that starts or ends a session. */
@Injectable()
export class SessionCookies {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Sets the refresh cookie and returns the session body for the client. */
  start(response: Response, session: IssuedSession): SessionResponse {
    response.cookie(REFRESH_COOKIE, session.refreshToken, this.options());
    return session.response;
  }

  clear(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.options());
  }

  read(request: Request): string | null {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Cookie-authenticated endpoints refuse other sites (CSRF). SameSite=Strict already blocks
   * this in current browsers; the Origin check covers older ones.
   */
  assertSameOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (origin && origin !== this.env.WEB_ORIGIN) {
      throw new ForbiddenException('Cross-site request refused.');
    }
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    };
  }
}
