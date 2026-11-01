import { ROLE_LABELS, SHARED_ROUTES, type Role } from '@lead/schema';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Bell, Menu, Search } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { errorMessage, FormMessage } from '../components/form';
import { MobileDrawer } from './MobileDrawer';
import { useAuth } from '../auth/session';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  readonly role: Role;
  readonly children: ReactNode;
}

/** Layout shared by every signed-in screen: sidebar, top bar (search, alerts, account) and content. */
export function AppShell({ role, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const auth = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const accountLabel = `${ROLE_LABELS[role]} account`;
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Signing out ends the session in every tab. If the server cannot be reached the user stays
  // signed in and is told, rather than leaving a live session behind on a shared computer.
  const logout = () => {
    setSignOutError(null);
    closeMenu();
    auth
      .signOut()
      .then(() => navigate({ to: '/' }))
      .catch((error: unknown) => {
        setSignOutError(`Could not sign out. ${errorMessage(error)}`);
      });
  };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {menuOpen && (
        <MobileDrawer onClose={closeMenu}>
          <Sidebar role={role} onNavigate={closeMenu} onLogout={logout} />
        </MobileDrawer>
      )}

      <div className="flex h-full" inert={menuOpen}>
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">
          <Sidebar role={role} onLogout={logout} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
            <button
              type="button"
              className="rounded-xl p-2 transition-colors hover:bg-brand-soft md:hidden"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>

            <form
              role="search"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-surface-muted px-4 py-2 transition-all duration-300 focus-within:border-brand focus-within:bg-surface focus-within:shadow-[0_0_0_4px_rgba(249,115,22,0.15)] md:max-w-xl"
              onSubmit={(event) => {
                event.preventDefault();
                void navigate({ to: SHARED_ROUTES.search.path });
              }}
            >
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <label htmlFor="global-search" className="sr-only">
                Search permitted courses, resources or records
              </label>
              <input
                id="global-search"
                type="search"
                placeholder="Search courses, resources or records…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </form>

            <Link
              to={SHARED_ROUTES.notifications.path}
              aria-label="Notifications"
              className="ml-auto rounded-xl p-2 transition-colors hover:bg-brand-soft hover:text-brand-strong"
            >
              <Bell aria-hidden="true" className="size-5" />
            </Link>

            <Link
              to={SHARED_ROUTES.profile.path}
              aria-label={accountLabel}
              className="flex items-center gap-2 rounded-xl px-1 py-1 text-sm transition-colors hover:bg-brand-soft sm:px-2"
            >
              <span
                aria-hidden="true"
                className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-brand-text shadow-[0_4px_12px_rgba(249,115,22,0.35)]"
              >
                {ROLE_LABELS[role].charAt(0)}
              </span>
              <span aria-hidden="true" className="hidden font-medium sm:block">
                {accountLabel}
              </span>
            </Link>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto px-4 py-6 outline-none md:px-8"
          >
            {signOutError && (
              <div className="mb-4">
                <FormMessage tone="error">{signOutError}</FormMessage>
              </div>
            )}
            {/* Re-keyed per page, so every navigation plays the entrance animation. */}
            <div key={pathname} className="animate-rise">
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
