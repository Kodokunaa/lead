import { homePathFor, NAVIGATION, ROLES, SHARED_ROUTES, type Role } from '@lead/schema';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useLocation,
  type AnyRoute,
  type RouterHistory,
} from '@tanstack/react-router';
import type { SessionState } from './auth/auth-store';
import { useSession } from './auth/session';
import { ForgotPasswordPage, RegisterPage, TokenPasswordPage } from './pages/auth/AccountPages';
import { SignInPage } from './pages/auth/SignInPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { SecurityPage } from './pages/SecurityPage';
import { AppShell } from './shell/AppShell';

export interface RouterContext {
  readonly session: SessionState;
}

function roleOf(session: SessionState): Role | null {
  return session.status === 'signed-in' ? session.user.role : null;
}

/**
 * Where to go after signing in. Only a path on this site: it must start with one "/", so
 * "//evil.example" or "https://…" cannot turn sign-in into an open redirect.
 */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

interface SignInSearch {
  readonly redirect?: string;
}

const SHARED_TITLES: Readonly<Record<keyof typeof SHARED_ROUTES, string>> = {
  notifications: 'Notifications',
  profile: 'Profile and account',
  security: 'Account preferences and security',
  search: 'Permission-scoped search',
};

function SignedInLayout() {
  const session = useSession();
  if (session.status !== 'signed-in') return null;
  return (
    <AppShell role={session.user.role}>
      <Outlet />
    </AppShell>
  );
}

function SecurityRoute() {
  const session = useSession();
  return session.status === 'signed-in' ? <SecurityPage user={session.user} /> : null;
}

/** Pages opened from emailed links read their token from the URL fragment. */
function LinkTokenPage({ kind }: { kind: 'confirm' | 'reset' }) {
  const { hash } = useLocation();
  const path = kind === 'confirm' ? '/confirm-email' : '/reset-password';
  return <TokenPasswordPage hash={hash} kind={kind} path={path} />;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const target = safeRedirect(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: ({ context, search }) => {
    const role = roleOf(context.session);
    if (!role) return;
    // Checked here, not only in validateSearch: the router passes unvalidated keys through.
    // A role guard further down sends a link to another role's page back to this role's home.
    const target = safeRedirect(search.redirect);
    if (target) throw redirect({ href: target });
    throw redirect({ to: homePathFor(role) });
  },
  component: SignInPage,
});

/** Signed-out account screens; reachable whether or not someone is signed in. */
const accountRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/register', component: RegisterPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: ForgotPasswordPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/reset-password',
    component: () => <LinkTokenPage kind="reset" />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/confirm-email',
    component: () => <LinkTokenPage kind="confirm" />,
  }),
];

/** Every signed-in screen sits under this layout; without a session the user goes to sign in. */
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'signed-in',
  beforeLoad: ({ context, location }) => {
    if (roleOf(context.session)) return;
    // Remember the deep link, so signing in returns to it.
    throw redirect({ to: '/', search: { redirect: location.href } });
  },
  component: SignedInLayout,
});

function roleRoutes(role: Role): AnyRoute[] {
  return NAVIGATION[role]
    .filter((item) => item.path.startsWith(`/${role}`))
    .map((item) =>
      createRoute({
        getParentRoute: () => signedInRoute,
        path: item.path,
        // Client-side convenience only: the API enforces role access.
        beforeLoad: ({ context }: { context: RouterContext }) => {
          const current = roleOf(context.session);
          if (current !== role) throw redirect({ to: homePathFor(current ?? role) });
        },
        component: () => <PlaceholderPage title={item.label} screen={item.screen} />,
      }),
    );
}

const sharedRoutes = (Object.keys(SHARED_ROUTES) as (keyof typeof SHARED_ROUTES)[]).map((key) =>
  createRoute({
    getParentRoute: () => signedInRoute,
    path: SHARED_ROUTES[key].path,
    component:
      key === 'security'
        ? SecurityRoute
        : () => <PlaceholderPage title={SHARED_TITLES[key]} screen={SHARED_ROUTES[key].screen} />,
  }),
);

const routeTree = rootRoute.addChildren([
  signInRoute,
  ...accountRoutes,
  signedInRoute.addChildren([...ROLES.flatMap(roleRoutes), ...sharedRoutes]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { session: { status: 'loading' } },
    defaultNotFoundComponent: () => <PlaceholderPage title="Page not found" screen="X02" />,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
