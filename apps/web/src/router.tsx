import { homePathFor, NAVIGATION, ROLES, SHARED_ROUTES, type Role } from '@lead/schema';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useLocation,
  type AnyRoute,
  type RouteComponent,
  type RouterHistory,
} from '@tanstack/react-router';
import type { CurrentUser } from '@lead/schema';
import type { ComponentType, ReactElement } from 'react';
import type { SessionState } from './auth/auth-store';
import { useSession } from './auth/session';
import { ForgotPasswordPage, RegisterPage, TokenPasswordPage } from './pages/auth/AccountPages';
import { SignInPage } from './pages/auth/SignInPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import {
  CalendarPage,
  CatalogPage,
  ClassOverviewPage,
  AssessmentQuestionsPage,
  AssessmentReviewPage,
  AssessmentRubricPage,
  AssessmentSettingsPage,
  AssessmentsPage,
  AssignmentPage,
  AttemptPage,
  AttemptResultPage,
  AttemptReviewPage,
  ContentHomePage,
  GradingPage,
  GradingQueuePage,
  CourseRecordPage,
  CourseOutlinePage,
  LessonEditorPage,
  ModuleEditorPage,
  MyClassesPage,
  MyCoursesPage,
  StudentAssessmentPage,
  StudentAssessmentsPage,
  ProfilePage,
  ResourceLibraryPage,
  ResourceReviewPage,
  ResourcesPage,
  RolesPage,
  SearchPage,
  SectionDetailsPage,
  SectionsPage,
  SecurityPage,
  StudentCoursePage,
  StudentLessonPage,
  StudentResourcePage,
  UserDetailsPage,
  UsersPage,
} from './pages/lazy';
import { PlaceholderPage } from './pages/PlaceholderPage';
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

function CalendarRoute(): ReactElement {
  const termId = calendarRoute.useSearch({ select: (search: CalendarSearch) => search.term });
  return <CalendarPage termId={termId} />;
}

function AssessmentSettingsRoute(): ReactElement {
  const assessmentId = assessmentSettingsRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <AssessmentSettingsPage key={assessmentId} assessmentId={assessmentId} />;
}

function AssessmentQuestionsRoute(): ReactElement {
  const assessmentId = assessmentQuestionsRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <AssessmentQuestionsPage key={assessmentId} assessmentId={assessmentId} />;
}

function AssessmentRubricRoute(): ReactElement {
  const assessmentId = assessmentRubricRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <AssessmentRubricPage key={assessmentId} assessmentId={assessmentId} />;
}

function AssessmentReviewRoute(): ReactElement {
  const assessmentId = assessmentReviewRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <AssessmentReviewPage key={assessmentId} assessmentId={assessmentId} />;
}

function StudentAssessmentView(): ReactElement {
  const assessmentId = studentAssessmentRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <StudentAssessmentPage key={assessmentId} assessmentId={assessmentId} />;
}

function AttemptView(): ReactElement {
  const attemptId = attemptRoute.useParams({
    select: (params: { attemptId: string }) => params.attemptId,
  });
  return <AttemptPage key={attemptId} attemptId={attemptId} />;
}

function AttemptReviewView(): ReactElement {
  const attemptId = attemptReviewRoute.useParams({
    select: (params: { attemptId: string }) => params.attemptId,
  });
  return <AttemptReviewPage key={attemptId} attemptId={attemptId} />;
}

function AttemptResultView(): ReactElement {
  const attemptId = attemptResultRoute.useParams({
    select: (params: { attemptId: string }) => params.attemptId,
  });
  return <AttemptResultPage key={attemptId} attemptId={attemptId} />;
}

function AssignmentView(): ReactElement {
  const assessmentId = assignmentRoute.useParams({
    select: (params: { assessmentId: string }) => params.assessmentId,
  });
  return <AssignmentPage key={assessmentId} assessmentId={assessmentId} />;
}

function GradingView(): ReactElement {
  const { assessmentId, studentId } = gradingRoute.useParams({
    select: (params: { assessmentId: string; studentId: string }) => params,
  });
  return (
    <GradingPage
      key={`${assessmentId}:${studentId}`}
      assessmentId={assessmentId}
      studentId={studentId}
    />
  );
}

function ResourcesRoute(): ReactElement {
  const courseId = resourcesRoute.useParams({
    select: (params: { courseId: string }) => params.courseId,
  });
  return <ResourcesPage key={courseId} courseId={courseId} />;
}

function ResourceReviewRoute(): ReactElement {
  const resourceId = resourceReviewRoute.useParams({
    select: (params: { resourceId: string }) => params.resourceId,
  });
  return <ResourceReviewPage key={resourceId} resourceId={resourceId} />;
}

function StudentCourseRoute(): ReactElement {
  const sectionId = studentCourseRoute.useParams({
    select: (params: { sectionId: string }) => params.sectionId,
  });
  return <StudentCoursePage key={sectionId} sectionId={sectionId} />;
}

function StudentLessonRoute(): ReactElement {
  const { sectionId, lessonId } = studentLessonRoute.useParams({
    select: (params: { sectionId: string; lessonId: string }) => params,
  });
  return <StudentLessonPage key={lessonId} sectionId={sectionId} lessonId={lessonId} />;
}

function StudentResourceRoute(): ReactElement {
  const { sectionId, resourceId } = studentResourceRoute.useParams({
    select: (params: { sectionId: string; resourceId: string }) => params,
  });
  return <StudentResourcePage key={resourceId} sectionId={sectionId} resourceId={resourceId} />;
}

function CourseRecordRoute(): ReactElement {
  const courseId = courseRecordRoute.useParams({
    select: (params: { courseId: string }) => params.courseId,
  });
  return <CourseRecordPage key={courseId} courseId={courseId} />;
}

function ClassOverviewRoute(): ReactElement {
  const sectionId = classOverviewRoute.useParams({
    select: (params: { sectionId: string }) => params.sectionId,
  });
  return <ClassOverviewPage key={sectionId} sectionId={sectionId} />;
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
const BUILT_PAGES: Readonly<Partial<Record<string, RouteComponent>>> = {
  '/admin/users': UsersPage,
  '/admin/roles': RolesPage,
  '/admin/courses': CatalogPage,
  '/admin/sections': SectionsPage,
  '/teacher/classes': MyClassesPage,
  '/teacher/content': ContentHomePage,
  '/teacher/assessments': AssessmentsPage,
  '/student/courses': MyCoursesPage,
  '/student/assessments': StudentAssessmentsPage,
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

interface CalendarSearch {
  readonly term?: string;
}

/**
 * The term is a search parameter (?term=…), not part of the path: a new path would be a new
 * route match and remount the page, dropping focus from the term list on every change.
 */
const calendarRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/courses/calendar',
  validateSearch: (search: Record<string, unknown>): CalendarSearch =>
    typeof search.term === 'string' && search.term ? { term: search.term } : {},
  beforeLoad: requireRole('admin'),
  component: CalendarRoute,
});

const assessmentSettingsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/assessments/$assessmentId',
  beforeLoad: requireRole('teacher'),
  component: AssessmentSettingsRoute,
});

const assessmentQuestionsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/assessments/$assessmentId/questions',
  beforeLoad: requireRole('teacher'),
  component: AssessmentQuestionsRoute,
});

const assessmentRubricRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/assessments/$assessmentId/rubric',
  beforeLoad: requireRole('teacher'),
  component: AssessmentRubricRoute,
});

const assessmentReviewRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/assessments/$assessmentId/review',
  beforeLoad: requireRole('teacher'),
  component: AssessmentReviewRoute,
});

const studentAssessmentRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/assessments/$assessmentId',
  beforeLoad: requireRole('student'),
  component: StudentAssessmentView,
});

const attemptRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/attempts/$attemptId',
  beforeLoad: requireRole('student'),
  component: AttemptView,
});

const attemptReviewRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/attempts/$attemptId/review',
  beforeLoad: requireRole('student'),
  component: AttemptReviewView,
});

const attemptResultRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/attempts/$attemptId/result',
  beforeLoad: requireRole('student'),
  component: AttemptResultView,
});

const assignmentRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/assignments/$assessmentId',
  beforeLoad: requireRole('student'),
  component: AssignmentView,
});

/** T13; reached from Assessment management (it has no sidebar entry of its own). */
const gradingQueueRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/grading',
  beforeLoad: requireRole('teacher'),
  component: GradingQueuePage,
});

const gradingRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/grading/$assessmentId/$studentId',
  beforeLoad: requireRole('teacher'),
  component: GradingView,
});

const resourcesRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/content/$courseId/resources',
  beforeLoad: requireRole('teacher'),
  component: ResourcesRoute,
});

const resourceLibraryRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/courses/resources',
  beforeLoad: requireRole('admin'),
  component: ResourceLibraryPage,
});

const resourceReviewRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/courses/resources/$resourceId',
  beforeLoad: requireRole('admin'),
  component: ResourceReviewRoute,
});

const studentCourseRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/courses/$sectionId',
  beforeLoad: requireRole('student'),
  component: StudentCourseRoute,
});

const studentLessonRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/courses/$sectionId/lessons/$lessonId',
  beforeLoad: requireRole('student'),
  component: StudentLessonRoute,
});

const studentResourceRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/student/courses/$sectionId/resources/$resourceId',
  beforeLoad: requireRole('student'),
  component: StudentResourceRoute,
});

/** A06; static paths like /admin/courses/calendar are matched before this one. */
const courseRecordRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/admin/courses/$courseId',
  beforeLoad: requireRole('admin'),
  component: CourseRecordRoute,
});

const classOverviewRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/teacher/classes/$sectionId',
  beforeLoad: requireRole('teacher'),
  component: ClassOverviewRoute,
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
  classOverviewRoute,
  calendarRoute,
  courseRecordRoute,
  resourcesRoute,
  assignmentRoute,
  gradingQueueRoute,
  gradingRoute,
  studentAssessmentRoute,
  attemptRoute,
  attemptReviewRoute,
  attemptResultRoute,
  assessmentSettingsRoute,
  assessmentQuestionsRoute,
  assessmentRubricRoute,
  assessmentReviewRoute,
  resourceLibraryRoute,
  resourceReviewRoute,
  studentCourseRoute,
  studentLessonRoute,
  studentResourceRoute,
  courseOutlineRoute,
  moduleEditorRoute,
  lessonEditorRoute,
  createRoute({
    getParentRoute: () => signedInRoute,
    path: '/access-denied',
    component: AccessDeniedRoute,
  }),
];

interface SearchParams {
  readonly q?: string;
}

function SearchRoute(): ReactElement {
  const q = searchRoute.useSearch({ select: (search: SearchParams) => search.q ?? '' });
  return <SearchPage q={q} />;
}

/** H09: the query is a search parameter (?q=…) so a search can be bookmarked or shared. */
const searchRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: SHARED_ROUTES.search.path,
  validateSearch: (search: Record<string, unknown>): SearchParams =>
    typeof search.q === 'string' && search.q ? { q: search.q.slice(0, 100) } : {},
  component: SearchRoute,
});

const sharedRoutes = (Object.keys(SHARED_ROUTES) as (keyof typeof SHARED_ROUTES)[])
  .filter((key) => key !== 'search')
  .map((key) =>
    createRoute({
      getParentRoute: () => signedInRoute,
      path: SHARED_ROUTES[key].path,
      component:
        key === 'security'
          ? withUser(SecurityPage)
          : key === 'profile'
            ? withUser(ProfilePage)
            : () => (
                <PlaceholderPage title={SHARED_TITLES[key]} screen={SHARED_ROUTES[key].screen} />
              ),
    }),
  );

const routeTree = rootRoute.addChildren([
  signInRoute,
  ...accountRoutes,
  signedInRoute.addChildren([
    ...ROLES.flatMap(roleRoutes),
    ...extraSignedInRoutes,
    ...sharedRoutes,
    searchRoute,
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
