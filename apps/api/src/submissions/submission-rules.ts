import type { StudentAssessmentState } from '@lead/schema';

export interface SubmissionWindow {
  readonly opensAt: Date;
  readonly dueAt: Date;
  readonly maxAttempts: number;
  readonly acceptLate: boolean;
}

const TIME = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Why a student cannot upload or submit now, or null. `submitted` counts confirmed ones. */
export function submissionBlockedReason(
  window: SubmissionWindow,
  submitted: number,
  now: Date,
): string | null {
  if (now < window.opensAt) return `It opens on ${TIME.format(window.opensAt)}.`;
  if (submitted >= window.maxAttempts) return 'You have used all your submissions.';
  if (now >= window.dueAt && !window.acceptLate) return 'This assignment is closed.';
  return null;
}

/** Where an assignment or project stands for one student (S07). */
export function submissionState(
  window: SubmissionWindow,
  submitted: number,
  now: Date,
): StudentAssessmentState {
  if (now < window.opensAt) return 'scheduled';
  if (submitted > 0) return 'submitted';
  if (now >= window.dueAt && !window.acceptLate) return 'missed';
  return 'available';
}
