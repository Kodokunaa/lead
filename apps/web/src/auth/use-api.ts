import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../components/form';
import { useAuth } from './session';

export type ApiData<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  /**
   * `refreshing` while a newer request runs; the previous data stays on screen meanwhile.
   * `refreshError` says a reload failed: the data shown is the last good answer.
   */
  | {
      readonly status: 'ready';
      readonly data: T;
      readonly refreshing: boolean;
      readonly refreshError?: string;
    };

/**
 * Loads `path` with the signed-in session and reloads on demand. Shown data stays in place
 * during a reload (so focus and scroll position survive), and an answer for an older request
 * is dropped, so fast filter changes cannot show stale results. A failed reload of the same path
 * keeps the data (and any form built on it) and reports `refreshError` instead of replacing the
 * page; a failed load of a different path shows the error, never the old path's data.
 */
export function useApiData<T>(path: string): ApiData<T> & { readonly reload: () => void } {
  const auth = useAuth();
  const [state, setState] = useState<ApiData<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    setState((previous) =>
      previous.status === 'ready'
        ? { status: 'ready', data: previous.data, refreshing: true }
        : { status: 'loading' },
    );
    auth
      .request<T>(path)
      .then((data) => {
        if (!current) return;
        loadedPath.current = path;
        setState({ status: 'ready', data, refreshing: false });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const message = errorMessage(error);
        const samePath = loadedPath.current === path;
        setState((previous) =>
          previous.status === 'ready' && samePath
            ? { status: 'ready', data: previous.data, refreshing: false, refreshError: message }
            : { status: 'error', message },
        );
      });
    return () => {
      current = false;
    };
  }, [auth, path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
