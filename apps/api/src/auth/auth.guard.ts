import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@lead/schema';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { UserRow } from '../database/schema';
import { AuthError, AuthService } from './auth.service';
import { verifyAccessToken } from './tokens';

const IS_PUBLIC = 'lead:isPublic';
const ROLES = 'lead:roles';

/** Opens a route to signed-out callers. Every other route requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Limits a route (or controller) to the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export interface AuthenticatedRequest extends Request {
  user?: UserRow;
  /** The signed-in session family, e.g. to keep it when signing out other devices. */
  sessionFamily?: string;
}

/** The signed-in user. Only valid on routes that are not @Public(). */
export const CurrentUserRow = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new AuthError('session_invalid');
  return user;
});

/** The current session family. Only valid on routes that are not @Public(). */
export const CurrentSessionFamily = createParamDecorator(
  (_: unknown, context: ExecutionContext) => {
    const family = context.switchToHttp().getRequest<AuthenticatedRequest>().sessionFamily;
    if (!family) throw new AuthError('session_invalid');
    return family;
  },
);

/** Global guard: authentication by default, then role checks from @Roles(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    const claims = token ? await verifyAccessToken(token, this.env.JWT_SECRET) : null;
    const user = claims ? await this.auth.findActiveUser(claims) : null;
    if (!user) throw new AuthError('session_invalid');
    request.user = user;
    request.sessionFamily = claims?.sessionFamily;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this page.');
    }
    return true;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
