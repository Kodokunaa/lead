import type {
  CurrentUser,
  MfaChallengeResponse,
  SessionResponse,
  SignInResponse,
} from '@lead/schema';
import { ApiError, apiRequest, type ApiRequest } from './api';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  /** The API could not be reached at start-up; the session may still be valid. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'signed-in'; readonly user: CurrentUser };

export type SignInResult = { readonly mfaRequired: false } | MfaChallengeResponse;

export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };

const REFRESH_LOCK = 'lead-auth-refresh';
const CHANNEL = 'lead-auth';
/** After a 409 another tab has just rotated the cookie; give the browser a moment to store it. */
const SUPERSEDED_RETRY_MS = 300;

type AuthMessage = { readonly type: 'signed-in' } | { readonly type: 'signed-out' };

function isAuthMessage(data: unknown): data is AuthMessage {
  const type = (data as { type?: unknown } | null)?.type;
  return type === 'signed-in' || type === 'signed-out';
}

type RefreshOutcome = 'ok' | 'signed-out' | 'unavailable';

/**
 * The browser's session. The access token lives only in memory; the refresh token is an
 * httpOnly cookie the browser sends to /api/auth. Refreshes run one at a time across tabs
 * (Web Locks) because the API treats a reused refresh token as theft, and sign-in or
 * sign-out in one tab reaches the others (BroadcastChannel).
 */
export class AuthStore {
  private state: SessionState = { status: 'loading' };
  private accessToken: string | null = null;
  private refreshing: Promise<RefreshOutcome> | null = null;
  /** Bumped by sign-in and sign-out, so a refresh that started earlier cannot undo them. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;

  constructor() {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    this.channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isAuthMessage(event.data)) return;
      if (event.data.type === 'signed-out') this.endLocalSession(false);
      else void this.refresh();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SessionState => this.state;

  /** Stops listening to other tabs. */
  close(): void {
    this.channel?.close();
  }

  /** Restores the session from the refresh cookie when the app opens (or on retry). */
  async start(): Promise<void> {
    const outcome = await this.refresh();
    if (outcome === 'unavailable' && this.state.status !== 'signed-in') {
      this.setState({ status: 'unavailable' });
    }
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const response = await apiRequest<SignInResponse>('/auth/sign-in', {
      body: { email, password },
    });
    if ('mfaRequired' in response) return response;
    this.accept(response, true);
    return { mfaRequired: false };
  }

  async verifySecondFactor(challengeToken: string, factor: SecondFactor): Promise<void> {
    const response = await apiRequest<SessionResponse>('/auth/mfa/verify', {
      body: { challengeToken, ...factor },
    });
    this.accept(response, true);
  }

  /**
   * Ends the session on the server first. If that fails the user stays signed in and the
   * error is thrown, so nobody walks away from a shared computer believing they signed out.
   */
  async signOut(): Promise<void> {
    await this.refreshing;
    await apiRequest('/auth/sign-out', { method: 'POST' });
    this.endLocalSession(true);
  }

  /**
   * Forgets the session in this browser without asking the server, e.g. after a password
   * reset, which has already ended every session server-side.
   */
  endLocalSession(announce: boolean): void {
    this.generation += 1;
    this.accessToken = null;
    this.setState({ status: 'signed-out' });
    if (announce) this.channel?.postMessage({ type: 'signed-out' } satisfies AuthMessage);
  }

  /** Authenticated request; refreshes the access token once if it has expired. */
  async request<T>(path: string, request: Omit<ApiRequest, 'accessToken'> = {}): Promise<T> {
    try {
      return await apiRequest<T>(path, { ...request, accessToken: this.accessToken });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const outcome = await this.refresh();
      if (outcome === 'unavailable') {
        throw new ApiError(
          0,
          'The server could not be reached. Check your connection and try again.',
        );
      }
      if (outcome !== 'ok') throw error;
      return apiRequest<T>(path, { ...request, accessToken: this.accessToken });
    }
  }

  /** Re-reads the signed-in user, e.g. after turning MFA on or off. */
  async reloadUser(): Promise<void> {
    const user = await this.request<CurrentUser>('/auth/me');
    this.setState({ status: 'signed-in', user });
  }

  /** One refresh at a time per tab, and across tabs where the browser supports Web Locks. */
  private refresh(): Promise<RefreshOutcome> {
    this.refreshing ??= this.withRefreshLock(() => this.refreshOnce(this.generation)).finally(
      () => {
        this.refreshing = null;
      },
    );
    return this.refreshing;
  }

  private withRefreshLock(task: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks) return task();
    // The lock resolves with the task's promise; then() unwraps it to the outcome.
    return locks.request(REFRESH_LOCK, task).then((result) => result);
  }

  private async refreshOnce(generation: number, retried = false): Promise<RefreshOutcome> {
    try {
      const session = await apiRequest<SessionResponse>('/auth/refresh', { method: 'POST' });
      // A sign-in or sign-out happened meanwhile; this older answer must not override it.
      if (generation !== this.generation)
        return this.state.status === 'signed-in' ? 'ok' : 'signed-out';
      this.accept(session, false);
      return 'ok';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && !retried) {
        await new Promise((resolve) => setTimeout(resolve, SUPERSEDED_RETRY_MS));
        return this.refreshOnce(generation, true);
      }
      if (error instanceof ApiError && error.status === 401) {
        if (generation === this.generation) this.endLocalSession(false);
        return 'signed-out';
      }
      return 'unavailable';
    }
  }

  private accept(session: SessionResponse, announce: boolean): void {
    if (announce) this.generation += 1;
    this.accessToken = session.accessToken;
    this.setState({ status: 'signed-in', user: session.user });
    if (announce) this.channel?.postMessage({ type: 'signed-in' } satisfies AuthMessage);
  }

  private setState(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
