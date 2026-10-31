import type { Role } from './roles';

/** A sidebar entry. `screen` is the wireframe ID in reference/Wireframe.pdf. */
export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly screen: string;
  readonly icon: NavIcon;
}

export type NavIcon =
  | 'home'
  | 'book'
  | 'clipboard'
  | 'lightbulb'
  | 'sparkles'
  | 'chart'
  | 'bell'
  | 'user'
  | 'users'
  | 'layers'
  | 'flag'
  | 'lifebuoy'
  | 'file'
  | 'pen'
  | 'settings'
  | 'shield'
  | 'grid'
  | 'scroll';

/** Screens shared by every role (H06-H09). */
export const SHARED_ROUTES = {
  notifications: { path: '/notifications', screen: 'H06' },
  profile: { path: '/profile', screen: 'H07' },
  security: { path: '/security', screen: 'H08' },
  search: { path: '/search', screen: 'H09' },
} as const;

/** Sidebar per role, in wireframe order. */
export const NAVIGATION: Readonly<Record<Role, readonly NavItem[]>> = {
  student: [
    { label: 'Dashboard', path: '/student', screen: 'S01', icon: 'home' },
    { label: 'My Courses', path: '/student/courses', screen: 'S02', icon: 'book' },
    { label: 'Assessments', path: '/student/assessments', screen: 'S07', icon: 'clipboard' },
    {
      label: 'Recommendations',
      path: '/student/recommendations',
      screen: 'S15',
      icon: 'lightbulb',
    },
    { label: 'AI Learning Assistant', path: '/student/assistant', screen: 'S17', icon: 'sparkles' },
    { label: 'Progress', path: '/student/progress', screen: 'S18', icon: 'chart' },
    { label: 'Notifications', path: SHARED_ROUTES.notifications.path, screen: 'H06', icon: 'bell' },
    { label: 'Profile', path: SHARED_ROUTES.profile.path, screen: 'H07', icon: 'user' },
  ],
  teacher: [
    { label: 'Dashboard', path: '/teacher', screen: 'T01', icon: 'home' },
    { label: 'My Classes', path: '/teacher/classes', screen: 'T02', icon: 'book' },
    { label: 'Course Content', path: '/teacher/content', screen: 'T04', icon: 'layers' },
    { label: 'Assessments', path: '/teacher/assessments', screen: 'T08', icon: 'clipboard' },
    { label: 'Students', path: '/teacher/students', screen: 'T16', icon: 'users' },
    { label: 'Flagged Students', path: '/teacher/indicators', screen: 'T19', icon: 'flag' },
    { label: 'Interventions', path: '/teacher/interventions', screen: 'T22', icon: 'lifebuoy' },
    { label: 'Reports', path: '/teacher/analytics', screen: 'T18', icon: 'chart' },
    { label: 'AI Drafting Tools', path: '/teacher/copilot', screen: 'T25', icon: 'pen' },
    { label: 'Settings', path: SHARED_ROUTES.security.path, screen: 'H08', icon: 'settings' },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin', screen: 'A01', icon: 'home' },
    { label: 'User Management', path: '/admin/users', screen: 'A02', icon: 'users' },
    { label: 'Course Management', path: '/admin/courses', screen: 'A05', icon: 'book' },
    { label: 'Section Management', path: '/admin/sections', screen: 'A07', icon: 'grid' },
    { label: 'Roles & Permissions', path: '/admin/roles', screen: 'A04', icon: 'shield' },
    { label: 'Academic Analytics', path: '/admin/analytics', screen: 'A13', icon: 'chart' },
    { label: 'Reports', path: '/admin/reports', screen: 'A14', icon: 'file' },
    { label: 'Audit Logs', path: '/admin/audit', screen: 'A15', icon: 'scroll' },
    { label: 'System Settings', path: '/admin/settings', screen: 'A18', icon: 'settings' },
  ],
};

/** The landing path after sign-in for each role. */
export function homePathFor(role: Role): string {
  const [first] = NAVIGATION[role];
  if (!first) throw new Error(`No navigation defined for role ${role}`);
  return first.path;
}
