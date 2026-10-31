import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT, env.API_HOST);
  new Logger('Bootstrap').log(`API listening on http://${env.API_HOST}:${env.API_PORT}/api`);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'API failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
