import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Requests carry form data, never files; uploads get their own limit when they arrive. */
const JSON_BODY_LIMIT = '100kb';

/** Shared HTTP setup for the running server and integration tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix('api');
  if (env.TRUST_PROXY_HOPS > 0) app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cookieParser());
  // Auth responses carry tokens and recovery codes; no browser or proxy may cache them.
  app.use('/api/auth', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
}
