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
  if (user) api.on('GET /auth/me', { status: 200, body: user });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const route = `${init.method ?? 'GET'} ${input.replace(/^\/api/, '')}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
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
