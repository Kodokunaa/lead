import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { prepareTestDatabase } from './test-database';

describe('GET /api/health (integration)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = await prepareTestDatabase();
    process.env.WEB_ORIGIN ??= 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get<Env>(ENV));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API and database as up', async () => {
    const response = await request(server()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('sends security headers and restricts CORS to the web origin', async () => {
    const response = await request(server())
      .get('/api/health')
      .set('Origin', 'https://evil.example');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBe(process.env.WEB_ORIGIN);
  });
});
