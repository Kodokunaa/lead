import { describe, expect, it } from 'vitest';
import { countOf, describeAction, describeDevice, formatDateTime } from './format';

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
