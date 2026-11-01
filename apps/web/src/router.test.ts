import { describe, expect, it } from 'vitest';
import { safeRedirect } from './router';

describe('safeRedirect', () => {
  it('keeps paths on this site', () => {
    expect(safeRedirect('/teacher/indicators')).toBe('/teacher/indicators');
    expect(safeRedirect('/security?tab=mfa')).toBe('/security?tab=mfa');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'evil',
      '',
      42,
    ]) {
      expect(safeRedirect(value)).toBeNull();
    }
  });
});
