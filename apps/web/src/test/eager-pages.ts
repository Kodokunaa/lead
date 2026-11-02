/**
 * Test double for pages/lazy.ts: the same pages, imported eagerly. The test setup swaps it in so
 * tests never wait for a page's first lazy load; the app itself still loads pages per route.
 */
export { ProfilePage } from '../pages/ProfilePage';
export { SearchPage } from '../pages/SearchPage';
export { SecurityPage } from '../pages/SecurityPage';
export { RolesPage } from '../pages/admin/RolesPage';
export { UserDetailsPage } from '../pages/admin/UserDetailsPage';
export { UsersPage } from '../pages/admin/UsersPage';
export { CalendarPage } from '../pages/admin/calendar/CalendarPage';
export { CatalogPage } from '../pages/admin/catalog/CatalogPage';
export { CourseRecordPage } from '../pages/admin/catalog/CourseRecordPage';
export { ResourceLibraryPage } from '../pages/admin/resources/ResourceLibraryPage';
export { ResourceReviewPage } from '../pages/admin/resources/ResourceReviewPage';
export { SectionDetailsPage } from '../pages/admin/sections/SectionDetailsPage';
export { SectionsPage } from '../pages/admin/sections/SectionsPage';
export {
  StudentCoursePage,
  StudentLessonPage,
  StudentResourcePage,
} from '../pages/student/CoursePages';
export { MyCoursesPage } from '../pages/student/MyCoursesPage';
export { ClassOverviewPage } from '../pages/teacher/ClassOverviewPage';
export { MyClassesPage } from '../pages/teacher/MyClassesPage';
export { ContentHomePage, CourseOutlinePage } from '../pages/teacher/content/CourseOutlinePage';
export { LessonEditorPage } from '../pages/teacher/content/LessonEditorPage';
export { ModuleEditorPage } from '../pages/teacher/content/ModuleEditorPage';
export { ResourcesPage } from '../pages/teacher/content/ResourcesPage';
