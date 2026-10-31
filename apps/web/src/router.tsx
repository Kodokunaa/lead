import { homePathFor, NAVIGATION, ROLES, SHARED_ROUTES, type Role } from '@lead/schema';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type AnyRoute,
  type RouterHistory,
} from '@tanstack/react-router';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PreviewSignInPage } from './pages/PreviewSignInPage';
import { AppShell } from './shell/AppShell';
import { usePreviewRole } from './shell/preview-role';

export interface RouterContext {
  readonly role: Role | null;
}

const SHARED_TITLES: Readonly<Record<keyof typeof SHARED_ROUTES, string>> = {
  notifications: 'Notifications',
  profile: 'Profile and account',
  security: 'Account preferences and security',
  search: 'Permission-scoped search',
};

function SignedInLayout() {
  const { role } = usePreviewRole();
  if (!role) return null;
  return (
    <AppShell role={role}>
      <Outlet />
    </AppShell>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    if (context.role) throw redirect({ to: homePathFor(context.role) });
  },
  component: PreviewSignInPage,
});

/** Every signed-in screen sits under this layout; without a role the user goes back to sign in. */
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'signed-in',
  beforeLoad: ({ context }) => {
    if (!context.role) throw redirect({ to: '/' });
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
        // Client-side convenience only: the API enforces role access from Phase 1 onward.
        beforeLoad: ({ context }: { context: RouterContext }) => {
          if (context.role !== role) throw redirect({ to: homePathFor(context.role ?? role) });
        },
        component: () => <PlaceholderPage title={item.label} screen={item.screen} />,
      }),
    );
}

const sharedRoutes = (Object.keys(SHARED_ROUTES) as (keyof typeof SHARED_ROUTES)[]).map((key) =>
  createRoute({
    getParentRoute: () => signedInRoute,
    path: SHARED_ROUTES[key].path,
    component: () => (
      <PlaceholderPage title={SHARED_TITLES[key]} screen={SHARED_ROUTES[key].screen} />
    ),
  }),
);

const routeTree = rootRoute.addChildren([
  signInRoute,
  signedInRoute.addChildren([...ROLES.flatMap(roleRoutes), ...sharedRoutes]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { role: null },
    defaultNotFoundComponent: () => <PlaceholderPage title="Page not found" screen="X02" />,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
