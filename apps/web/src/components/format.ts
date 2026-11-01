import { SEMESTER_LABELS, type Semester } from '@lead/schema';

const DATE_TIME = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
});

/** Dates are shown in Philippine time, whatever the device's clock is set to. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

const DAY = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });

/** Calendar days (YYYY-MM-DD) are formatted without shifting time zones. */
export function formatDay(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

/** "Oct 12, 2026" or "Oct 12, 2026 – Oct 16, 2026". */
export function formatDaySpan(startsOn: string, endsOn: string | null): string {
  return endsOn && endsOn !== startsOn
    ? `${formatDay(startsOn)} – ${formatDay(endsOn)}`
    : formatDay(startsOn);
}

const MANILA_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar day in the Philippines, as YYYY-MM-DD. */
export function todayInManila(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    MANILA_PARTS.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A short, readable device name from a browser's user-agent string. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const system = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? userAgent.slice(0, 40);
}

/** Audit action names read as sentences in activity lists. */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'auth.signed_in': 'Signed in',
  'auth.signed_out': 'Signed out',
  'auth.sign_in_failed': 'Sign-in failed',
  'auth.locked_out': 'Locked out after failed sign-ins',
  'auth.session_revoked': 'Signed a device out',
  'auth.refresh_reused': 'Stolen session token detected',
  'auth.mfa_enabled': 'Turned on two-step verification',
  'auth.mfa_disabled': 'Turned off two-step verification',
  'auth.mfa_failed': 'Two-step code refused',
  'auth.recovery_code_used': 'Used a recovery code',
  'auth.registered': 'Requested an account',
  'auth.registration_repeated': 'Requested an account again',
  'auth.email_verified': 'Confirmed email address',
  'auth.password_reset_requested': 'Asked for a password reset',
  'auth.password_reset': 'Reset password',
  'auth.password_changed': 'Changed password',
  'account.approved': 'Account approved',
  'account.rejected': 'Registration rejected',
  'account.deactivated': 'Account deactivated',
  'account.reactivated': 'Account reactivated',
  'account.role_changed': 'Role changed',
  'account.mfa_reset': 'Two-step verification reset',
  'account.profile_updated': 'Updated profile',
};

export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** "1 course", "2 courses". */
export function countOf(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? '' : 's'}`;
}

/** "First Semester 2026-2027". */
export function termName(term: { semester: Semester; schoolYear: string }): string {
  return `${SEMESTER_LABELS[term.semester]} ${term.schoolYear}`;
}
