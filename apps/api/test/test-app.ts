import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { MAILER, type Mailer, type MailMessage } from '../src/mail/mail.module';
import { prepareTestDatabase, setTestApiEnv, type TestDatabase } from './test-database';

/** Keeps sent emails in memory so tests can read links out of them. */
export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  lastTo(email: string): MailMessage | undefined {
    return this.sent.filter((message) => message.to === email).at(-1);
  }
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly database: TestDatabase;
  readonly mailer: CapturingMailer;
  readonly server: () => Parameters<typeof request>[0];
}

/** The full API wired exactly as in production, connected to the test database as lead_app. */
export async function createTestApp(): Promise<TestApp> {
  const database = await prepareTestDatabase();
  setTestApiEnv(database.appUrl);
  const mailer = new CapturingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<Env>(ENV));
  await app.init();

  return {
    app,
    database,
    mailer,
    server: () => app.getHttpServer(),
  };
}
