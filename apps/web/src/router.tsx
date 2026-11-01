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
import type { CurrentUser } from '@lead/schema';
import type { ComponentType, ReactElement } from 'react';
import type { SessionState } from './auth/auth-store';
import { useSession } from './auth/session';
import { ForgotPasswordPage, RegisterPage, TokenPasswordPage } from './pages/auth/AccountPages';
import { SignInPage } from './pages/auth/SignInPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { CatalogPage } from './pages/admin/catalog/CatalogPage';
import { SectionDetailsPage } from './pages/admin/sections/SectionDetailsPage';
import { SectionsPage } from './pages/admin/sections/SectionsPage';
import { MyCoursesPage } from './pages/student/MyCoursesPage';
import { ContentHomePage, CourseOutlinePage } from './pages/teacher/content/CourseOutlinePage';
import { LessonEditorPage } from './pages/teacher/content/LessonEditorPage';
import { ModuleEditorPage } from './pages/teacher/content/ModuleEditorPage';
import { ClassRosterPage, MyClassesPage } from './pages/teacher/MyClassesPage';
import { RolesPage } from './pages/admin/RolesPage';
import { UserDetailsPage } from './pages/admin/UserDetailsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProfilePage } from './pages/ProfilePage';
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

/** Renders a page that needs the signed-in user (always present under the signed-in layout). */
function withUser(Page: ComponentType<{ user: CurrentUser }>) {
  return function SignedInPage() {
    const session = useSession();
    return session.status === 'signed-in' ? <Page user={session.user} /> : null;
  };
}

function UserDetailsRoute(): ReactElement | null {
  // The tree is assembled from lists, so the router cannot infer this route's params itself.
  const userId = userDetailsRoute.useParams({
    select: (params: { userId: string }) => params.userId,
  });
  const session = useSession();
  if (session.status !== 'signed-in') return null;
  return <UserDetailsPage key={userId} userId={userId} currentUserId={session.user.id} />;
}

function SectionDetailsRoute(): ReactElement {
  const sectionId = sectionDetailsRoute.useParams({
    select: (params: { sectionId: string }) => params.sectionId,
  });
  return <SectionDetailsPage key={sectionId} sectionId={sectionId} />;
}

function ClassRosterRoute(): ReactElement {
  const sectionId = classRosterRoute.useParams({
    select: (params: { sectionId: string }) => params.sectionId,
  });
  return <ClassRosterPage key={sectionId} sectionId={sectionId} />;
}

function CourseOutlineRoute(): ReactElement {
  const courseId = courseOutlineRoute.useParams({
    select: (params: { courseId: string }) => params.courseId,
  });
  return <CourseOutlinePage key={courseId} courseId={courseId} />;
}

function ModuleEditorRoute(): ReactElement {
  const { courseId, moduleId } = moduleEditorRoute.useParams({
    select: (params: { courseId: string; moduleId: string }) => params,
  });
  return <ModuleEditorPage key={moduleId} courseId={courseId} moduleId={moduleId} />;
}

function LessonEditorRoute(): ReactElement {
  const { courseId, lessonId } = lessonEditorRoute.useParams({
    select: (params: { courseId: string; lessonId: string }) => params,
  });
  return <LessonEditorPage key={lessonId} courseId={courseId} lessonId={lessonId} />;
}

function AccessDeniedRoute() {
  const session = useSession();
  return session.status === 'signed-in' ? <AccessDeniedPage role={session.user.role} /> : null;
}

/** Screens that are built; every other navigation entry still shows its placeholder. */
const BUILT_PAGES: Readonly<Partial<Record<string, () => ReactElement>>> = {
  '/admin/users': UsersPage,
  '/admin/roles': RolesPage,
  '/admin/courses': CatalogPage,
  '/admin/sections': SectionsPage,
  '/teacher/classes': MyClassesPage,
  '/teacher/content': ContentHomePage,
  '/student/courses': MyCoursesPage,
};

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
    // A link to another role's page ends on the access-denied page (X04) via requireRole.
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

/** Client-side convenience only: the API enforces role access. */
function requireRole(role: Role) {
  return ({ context }: { context: RouterContext }) => {
    if (roleOf(context.session) !== role) throw redirect({ to: '/access-denied' });
  };
}

function roleRoutes(role: Role): AnyRoute[] {
  return NAVIGATION[role]
    .filter((item) => item.path.startsWith(`/${role}`))
    .map((item) =>
      createRoute({
        getParentRoute: () => signedInRoute,
        path: item.path,
        beforeLoad: requireRole(role),
        component:
          BUILT_PAGES[item.path] ??
          (() => <PlaceholderPage title={item.label} screen={item.screen} />),
      }),
    );
}

const userDetailsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/users/$userId',
  beforeLoad: requireRole('admin'),
  component: UserDetailsRoute,
});

const sectionDetailsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/sections/$sectionId',
  beforeLoad: requireRole('admin'),
  component: SectionDetailsRoute,
});

const classRosterRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/classes/$sectionId',
  beforeLoad: requireRole('teacher'),
  component: ClassRosterRoute,
});

const courseOutlineRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/content/$courseId',
  beforeLoad: requireRole('teacher'),
  component: CourseOutlineRoute,
});

const moduleEditorRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/content/$courseId/modules/$moduleId',
  beforeLoad: requireRole('teacher'),
  component: ModuleEditorRoute,
});

const lessonEditorRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/content/$courseId/lessons/$lessonId',
  beforeLoad: requireRole('teacher'),
  component: LessonEditorRoute,
});

const extraSignedInRoutes = [
  userDetailsRoute,
  sectionDetailsRoute,
  classRosterRoute,
  courseOutlineRoute,
  moduleEditorRoute,
  lessonEditorRoute,
  createRoute({
    getParentRoute: () => signedInRoute,
    path: '/access-denied',
    component: AccessDeniedRoute,
  }),
];

const sharedRoutes = (Object.keys(SHARED_ROUTES) as (keyof typeof SHARED_ROUTES)[]).map((key) =>
  createRoute({
    getParentRoute: () => signedInRoute,
    path: SHARED_ROUTES[key].path,
    component:
      key === 'security'
        ? withUser(SecurityPage)
        : key === 'profile'
          ? withUser(ProfilePage)
          : () => <PlaceholderPage title={SHARED_TITLES[key]} screen={SHARED_ROUTES[key].screen} />,
  }),
);

const routeTree = rootRoute.addChildren([
  signInRoute,
  ...accountRoutes,
  signedInRoute.addChildren([
    ...ROLES.flatMap(roleRoutes),
    ...extraSignedInRoutes,
    ...sharedRoutes,
  ]),
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
