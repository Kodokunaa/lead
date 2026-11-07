import type { StudentAssessmentState } from '@lead/schema';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '../../../components/format';

export const STATE_LABELS: Record<StudentAssessmentState, string> = {
  scheduled: 'Scheduled',
  available: 'Available',
  in_progress: 'In progress',
  submitted: 'Submitted',
  missed: 'Missed',
};

const STATE_STYLES: Record<StudentAssessmentState, string> = {
  scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  available: 'border-green-200 bg-green-50 text-green-800',
  in_progress: 'border-orange-200 bg-accent text-brand-strong',
  submitted: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  missed: 'border-red-200 bg-red-50 text-red-800',
};

export function StateBadge({ state }: { state: StudentAssessmentState }) {
  return (
    <Badge variant="outline" className={`rounded-full ${STATE_STYLES[state]}`}>
      {STATE_LABELS[state]}
    </Badge>
  );
}

/**
 * Milliseconds left until `deadlineAt`, ticking every second. Counted on the server's clock:
 * the gap between the device and `serverNow` is measured once, when the attempt loads.
 */
export function useRemaining(deadlineAt: string, serverNow: string): number {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, new Date(deadlineAt).getTime() - (now + offset));
}

const DAY = 24 * 60 * 60 * 1000;

/** "18:42" or "1:05:09"; more than a day away, the deadline itself. */
export function formatRemaining(ms: number, deadlineAt: string): string {
  if (ms >= DAY) return `until ${formatDateTime(deadlineAt)}`;
  const seconds = Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Spoken warnings at these minutes left, so screen-reader users hear the clock. */
export function timeWarning(ms: number): string | null {
  const minutes = Math.ceil(ms / 60_000);
  if (ms > 0 && minutes === 5) return '5 minutes left.';
  if (ms > 0 && minutes === 1) return '1 minute left.';
  return null;
}
