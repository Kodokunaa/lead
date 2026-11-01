import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { App } from '../App';
import { AuthStore } from '../auth/auth-store';
import { AuthProvider } from '../auth/session';

const openStores = new Set<AuthStore>();

/** A session store that is closed after the test, so its tab channel does not leak. */
export function testStore(): AuthStore {
  const store = new AuthStore();
  openStores.add(store);
  return store;
}

export function closeTestStores(): void {
  for (const store of openStores) store.close();
  openStores.clear();
}

/** Renders the whole app at a path, with a fresh session store over the faked fetch. */
export function renderApp(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const store = testStore();
  render(
    <StrictMode>
      <AuthProvider store={store}>
        <App history={history} />
      </AuthProvider>
    </StrictMode>,
  );
  return { history, store };
}

export function mainNav(): HTMLElement {
  const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
  if (!nav) throw new Error('Main navigation not rendered');
  return nav;
}
