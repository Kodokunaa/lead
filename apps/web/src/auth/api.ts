/** An HTTP error from the API, with the message it gave for people to read. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FALLBACK_MESSAGE = 'Something went wrong. Check your connection and try again.';

export interface ApiRequest {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly accessToken?: string | null;
}

/** JSON request to the API on this origin (Vite proxies /api in development). */
export async function apiRequest<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.accessToken) headers.Authorization = `Bearer ${request.accessToken}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: request.method ?? (request.body === undefined ? 'GET' : 'POST'),
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, FALLBACK_MESSAGE);
  }

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw toApiError(response.status, payload);
  return payload as T;
}

function toApiError(status: number, payload: unknown): ApiError {
  if (payload && typeof payload === 'object') {
    const { message, code } = payload as { message?: unknown; code?: unknown };
    const text = Array.isArray(message) ? message.join(' ') : message;
    if (typeof text === 'string' && text.length > 0) {
      return new ApiError(status, text, typeof code === 'string' ? code : undefined);
    }
  }
  if (status === 429)
    return new ApiError(status, 'Too many attempts. Wait a minute and try again.');
  return new ApiError(status, FALLBACK_MESSAGE);
}
