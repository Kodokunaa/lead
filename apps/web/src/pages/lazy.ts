import { lazyPage as page } from './lazy-page';

/**
 * Signed-in pages, each loaded the first time its route opens, so the first screen (sign-in)
 * does not wait for every page in the app. The router imports pages from here only; the
 * sign-in and account pages, the shell and the small fallback pages stay in the main bundle.
 * Tests use test/eager-pages.ts in its place (see vite.config.ts); lazy-pages.test.ts keeps
 * the two lists the same.
 */

// ---------- Shared
export const ProfilePage = page(() => import('./ProfilePage').then((m) => m.ProfilePage));
export const SecurityPage = page(() => import('./SecurityPage').then((m) => m.SecurityPage));
export const SearchPage = page(() => import('./SearchPage').then((m) => m.SearchPage));

// ---------- Administrators
export const UsersPage = page(() => import('./admin/UsersPage').then((m) => m.UsersPage));
export const UserDetailsPage = page(() =>
  import('./admin/UserDetailsPage').then((m) => m.UserDetailsPage),
);
export const RolesPage = page(() => import('./admin/RolesPage').then((m) => m.RolesPage));
export const CatalogPage = page(() =>
  import('./admin/catalog/CatalogPage').then((m) => m.CatalogPage),
);
export const CourseRecordPage = page(() =>
  import('./admin/catalog/CourseRecordPage').then((m) => m.CourseRecordPage),
);
export const CalendarPage = page(() =>
  import('./admin/calendar/CalendarPage').then((m) => m.CalendarPage),
);
export const SectionsPage = page(() =>
  import('./admin/sections/SectionsPage').then((m) => m.SectionsPage),
);
export const SectionDetailsPage = page(() =>
  import('./admin/sections/SectionDetailsPage').then((m) => m.SectionDetailsPage),
);
export const ResourceLibraryPage = page(() =>
  import('./admin/resources/ResourceLibraryPage').then((m) => m.ResourceLibraryPage),
);
export const ResourceReviewPage = page(() =>
  import('./admin/resources/ResourceReviewPage').then((m) => m.ResourceReviewPage),
);

// ---------- Teachers
export const MyClassesPage = page(() =>
  import('./teacher/MyClassesPage').then((m) => m.MyClassesPage),
);
export const ClassOverviewPage = page(() =>
  import('./teacher/ClassOverviewPage').then((m) => m.ClassOverviewPage),
);
export const ContentHomePage = page(() =>
  import('./teacher/content/CourseOutlinePage').then((m) => m.ContentHomePage),
);
export const CourseOutlinePage = page(() =>
  import('./teacher/content/CourseOutlinePage').then((m) => m.CourseOutlinePage),
);
export const ModuleEditorPage = page(() =>
  import('./teacher/content/ModuleEditorPage').then((m) => m.ModuleEditorPage),
);
export const LessonEditorPage = page(() =>
  import('./teacher/content/LessonEditorPage').then((m) => m.LessonEditorPage),
);
export const ResourcesPage = page(() =>
  import('./teacher/content/ResourcesPage').then((m) => m.ResourcesPage),
);

// ---------- Students
export const MyCoursesPage = page(() =>
  import('./student/MyCoursesPage').then((m) => m.MyCoursesPage),
);
export const StudentCoursePage = page(() =>
  import('./student/CoursePages').then((m) => m.StudentCoursePage),
);
export const StudentLessonPage = page(() =>
  import('./student/CoursePages').then((m) => m.StudentLessonPage),
);
export const StudentResourcePage = page(() =>
  import('./student/CoursePages').then((m) => m.StudentResourcePage),
);
