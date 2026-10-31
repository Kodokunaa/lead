import { describe, expect, it } from 'vitest';
import { NAVIGATION, homePathFor } from './navigation';
import { ROLES } from './roles';

describe('NAVIGATION', () => {
  it('matches the wireframe sidebar order for each role', () => {
    expect(NAVIGATION.student.map((item) => item.label)).toEqual([
      'Dashboard',
      'My Courses',
      'Assessments',
      'Recommendations',
      'AI Learning Assistant',
      'Progress',
      'Notifications',
      'Profile',
    ]);
    expect(NAVIGATION.teacher).toHaveLength(10);
    expect(NAVIGATION.admin).toHaveLength(9);
  });

  it('gives every role unique paths and valid screen IDs', () => {
    for (const role of ROLES) {
      const paths = NAVIGATION[role].map((item) => item.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const item of NAVIGATION[role]) {
        expect(item.screen).toMatch(/^[HSTAX]\d{2}$/);
        expect(item.path.startsWith('/')).toBe(true);
      }
    }
  });

  it('lands each role on its own dashboard', () => {
    expect(homePathFor('student')).toBe('/student');
    expect(homePathFor('teacher')).toBe('/teacher');
    expect(homePathFor('admin')).toBe('/admin');
  });
});
