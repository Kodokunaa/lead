import { describe, expect, it, vi } from 'vitest';
import { fakeUser, installFakeApi, sessionFor, type FakeResponse } from '../test/fake-api';
import { testStore } from '../test/render-app';

describe('AuthStore', () => {
  it('starts signed out when the refresh cookie is missing or dead', async () => {
    installFakeApi();
    const store = testStore();

    await store.start();

    expect(store.getSnapshot()).toEqual({ status: 'signed-out' });
  });

  it('refreshes once and retries when the access token has expired', async () => {
    const user = fakeUser('teacher');
    const api = installFakeApi(user);
    const store = testStore();
    await store.start();

    let first = true;
    api.on('GET /auth/me', () => {
      if (first) {
        first = false;
        return { status: 401, body: { code: 'session_invalid' } };
      }
      return { status: 200, body: user };
    });

    await expect(store.request('/auth/me')).resolves.toEqual(user);
    expect(api.calls.filter((call) => call === 'POST /auth/refresh')).toHaveLength(2);
  });

  it('shares one refresh between parallel requests', async () => {
    const api = installFakeApi(fakeUser('student'));
    const store = testStore();

    await Promise.all([store.start(), store.start(), store.start()]);

    expect(api.calls.filter((call) => call === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('retries once after 409, when another tab has just rotated the cookie', async () => {
    const user = fakeUser('student');
    const api = installFakeApi();
    let attempts = 0;
    api.on('POST /auth/refresh', () => {
      attempts += 1;
      return attempts === 1
        ? { status: 409, body: { code: 'session_superseded' } }
        : sessionFor(user);
    });
    const store = testStore();

    await store.start();

    expect(store.getSnapshot()).toEqual({ status: 'signed-in', user });
    expect(attempts).toBe(2);
  });

  it('signs out every tab when one tab signs out', async () => {
    installFakeApi(fakeUser('admin'));
    const thisTab = testStore();
    const otherTab = testStore();
    await Promise.all([thisTab.start(), otherTab.start()]);
    expect(otherTab.getSnapshot().status).toBe('signed-in');

    const signedOut = new Promise<void>((resolve) => {
      otherTab.subscribe(() => {
        if (otherTab.getSnapshot().status === 'signed-out') resolve();
      });
    });
    await thisTab.signOut();
    await signedOut;

    expect(otherTab.getSnapshot()).toEqual({ status: 'signed-out' });
  });
});

describe('AuthStore ordering', () => {
  it('does not let a slow start-up refresh undo a sign-in', async () => {
    const user = fakeUser('teacher');
    const api = installFakeApi();
    let answerRefresh: (response: FakeResponse) => void = () => undefined;
    api.on(
      'POST /auth/refresh',
      () =>
        new Promise<FakeResponse>((resolve) => {
          answerRefresh = resolve;
        }),
    );
    api.on('POST /auth/sign-in', sessionFor(user));
    const store = testStore();

    const starting = store.start();
    await store.signIn(user.email, 'a long enough passphrase');
    answerRefresh({ status: 401, body: { code: 'session_invalid' } });
    await starting;

    expect(store.getSnapshot()).toEqual({ status: 'signed-in', user });
  });

  it('keeps the session when the server cannot sign it out', async () => {
    const api = installFakeApi(fakeUser('admin'));
    api.on('POST /auth/sign-out', { status: 500, body: { message: 'Server error' } });
    const store = testStore();
    await store.start();

    await expect(store.signOut()).rejects.toThrow('Server error');
    expect(store.getSnapshot().status).toBe('signed-in');
  });

  it('takes the cross-tab refresh lock when the browser has Web Locks', async () => {
    installFakeApi(fakeUser('student'));
    const lockNames: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: (name: string, callback: () => Promise<unknown>) => {
          lockNames.push(name);
          return Promise.resolve(callback());
        },
      },
    });
    const store = testStore();

    await store.start();

    expect(lockNames).toEqual(['lead-auth-refresh']);
    expect(store.getSnapshot().status).toBe('signed-in');
  });

  it('ignores messages that are not sign-in or sign-out', async () => {
    installFakeApi(fakeUser('student'));
    const store = testStore();
    await store.start();

    const channel = new BroadcastChannel('lead-auth');
    channel.postMessage(null);
    channel.postMessage({ type: 'something-else' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    channel.close();

    expect(store.getSnapshot().status).toBe('signed-in');
  });
});
