import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../components/form';
import { useAuth } from './session';

export type ApiData<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  /** `refreshing` while a newer request runs; the previous data stays on screen meanwhile. */
  | { readonly status: 'ready'; readonly data: T; readonly refreshing: boolean };

/**
 * Loads `path` with the signed-in session and reloads on demand. Shown data stays in place
 * during a reload (so focus and scroll position survive), and an answer for an older request
 * is dropped, so fast filter changes cannot show stale results.
 */
export function useApiData<T>(path: string): ApiData<T> & { readonly reload: () => void } {
  const auth = useAuth();
  const [state, setState] = useState<ApiData<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setState((previous) =>
      previous.status === 'ready' ? { ...previous, refreshing: true } : { status: 'loading' },
    );
    auth
      .request<T>(path)
      .then((data) => {
        if (current) setState({ status: 'ready', data, refreshing: false });
      })
      .catch((error: unknown) => {
        if (current) setState({ status: 'error', message: errorMessage(error) });
      });
    return () => {
      current = false;
    };
  }, [auth, path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
