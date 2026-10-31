import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { prepareTestDatabase, setTestApiEnv, type TestDatabase } from './test-database';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly database: TestDatabase;
  readonly server: () => Parameters<typeof request>[0];
}

/** The full API wired exactly as in production, connected to the test database as lead_app. */
export async function createTestApp(): Promise<TestApp> {
  const database = await prepareTestDatabase();
  setTestApiEnv(database.appUrl);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<Env>(ENV));
  await app.init();

  return {
    app,
    database,
    server: () => app.getHttpServer(),
  };
}
