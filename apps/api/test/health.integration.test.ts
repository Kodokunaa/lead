import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './test-app';

describe('GET /api/health (integration)', () => {
  let testApp: TestApp;
  const server = () => testApp.server();

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
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
