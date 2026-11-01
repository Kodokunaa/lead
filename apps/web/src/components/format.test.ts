import { describe, expect, it } from 'vitest';
import {
  countOf,
  describeAction,
  describeDevice,
  formatDateTime,
  formatDay,
  formatDaySpan,
  todayInManila,
} from './format';

describe('format', () => {
  it('shows times in Philippine time', () => {
    // 01:30 UTC is 09:30 in Manila.
    expect(formatDateTime('2026-11-01T01:30:00.000Z')).toContain('9:30');
  });

  it('names common browsers and systems', () => {
    expect(
      describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit Chrome/150.0 Safari/537'),
    ).toBe('Chrome on Windows');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 15) Chrome/150.0 Mobile Safari/537')).toBe(
      'Chrome on Android',
    );
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0) Version/19.0 Safari/605')).toBe(
      'Safari on iOS',
    );
    expect(describeDevice(null)).toBe('Unknown device');
  });

  it('reads audit actions as sentences, and leaves unknown ones as they are', () => {
    expect(describeAction('account.role_changed')).toBe('Role changed');
    expect(describeAction('something.new')).toBe('something.new');
  });
});

describe('countOf', () => {
  it('uses the singular for exactly one', () => {
    expect(countOf(1, 'course')).toBe('1 course');
    expect(countOf(0, 'course')).toBe('0 courses');
    expect(countOf(26, 'account')).toBe('26 accounts');
  });
});

describe('calendar days', () => {
  it('formats a day and a range without shifting time zones', () => {
    expect(formatDay('2026-08-10')).toBe('Aug 10, 2026');
    expect(formatDaySpan('2026-10-12', '2026-10-16')).toBe('Oct 12, 2026 – Oct 16, 2026');
    expect(formatDaySpan('2026-10-12', null)).toBe('Oct 12, 2026');
  });

  it('gives the date in Manila, which is ahead of UTC', () => {
    expect(todayInManila(new Date('2026-11-02T15:59:00Z'))).toBe('2026-11-02');
    expect(todayInManila(new Date('2026-11-02T16:00:00Z'))).toBe('2026-11-03');
  });
});
