import type { CurrentUser, Role } from '@lead/schema';
import { vi } from 'vitest';

export interface FakeResponse {
  readonly status: number;
  readonly body?: unknown;
}

type Handler = (body: unknown) => FakeResponse | Promise<FakeResponse>;

export interface FakeApi {
  /** Replaces the handler for `METHOD /path` (path without the /api prefix). */
  on(route: string, handler: Handler | FakeResponse): void;
  /** Requests received, as `METHOD /path`, in order. */
  readonly calls: string[];
  bodyOf(route: string): unknown;
}

export function fakeUser(role: Role, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: '7f9c2d1e-3b4a-4c5d-8e6f-0a1b2c3d4e5f',
    email: `${role}@lead.test`,
    displayName: `Test ${role}`,
    role,
    mfaEnabled: false,
    ...overrides,
  };
}

export function sessionFor(user: CurrentUser): FakeResponse {
  return { status: 200, body: { accessToken: `token-${user.role}`, expiresIn: 900, user } };
}

/**
 * Stubs fetch with an in-memory API. Unknown routes answer 404. Starts signed out
 * (refresh returns 401) unless `user` is given.
 */
export function installFakeApi(user: CurrentUser | null = null): FakeApi {
  const handlers = new Map<string, Handler>();
  const bodies = new Map<string, unknown>();
  const calls: string[] = [];

  const api: FakeApi = {
    calls,
    on(route, handler) {
      handlers.set(route, typeof handler === 'function' ? handler : () => handler);
    },
    bodyOf: (route) => bodies.get(route),
  };

  api.on(
    'POST /auth/refresh',
    user ? sessionFor(user) : { status: 401, body: { code: 'session_invalid' } },
  );
  api.on('POST /auth/sign-out', { status: 204 });
  if (user) {
    api.on('GET /auth/me', { status: 200, body: user });
    api.on('GET /me/sessions', {
      status: 200,
      body: [
        {
          id: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
          startedAt: '2026-11-01T00:00:00.000Z',
          lastActiveAt: '2026-11-01T00:00:00.000Z',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0',
          ipAddress: '127.0.0.1',
          current: true,
        },
      ],
    });
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const route = `${init.method ?? 'GET'} ${input.replace(/^\/api/, '')}`;
      // Form uploads are kept as FormData so tests can inspect their fields and files.
      const body: unknown =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : init.body instanceof FormData
            ? init.body
            : undefined;
      calls.push(route);
      bodies.set(route, body);
      const handler = handlers.get(route);
      const result = handler
        ? await handler(body)
        : { status: 404, body: { message: 'Not found' } };
      return new Response(result.status === 204 ? null : JSON.stringify(result.body ?? {}), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return api;
}
