import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Shared HTTP setup for the running server and integration tests. */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
}
