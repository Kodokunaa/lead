import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthStore, SessionState } from './auth-store';

const AuthContext = createContext<AuthStore | null>(null);

interface AuthProviderProps {
  readonly children: ReactNode;
  /** Tests pass their own store; the app creates one. */
  readonly store: AuthStore;
}

export function AuthProvider({ children, store }: AuthProviderProps) {
  useEffect(() => {
    void store.start();
  }, [store]);
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const store = useContext(AuthContext);
  if (!store) throw new Error('useAuth must be used inside AuthProvider');
  return store;
}

export function useSession(): SessionState {
  const store = useAuth();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
