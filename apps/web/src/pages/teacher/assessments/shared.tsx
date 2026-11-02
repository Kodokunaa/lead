import {
  ASSESSMENT_KIND_LABELS,
  usesQuestions,
  type AssessmentDetails,
  type AssessmentSummary,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { useApiData } from '../../../auth/use-api';
import { FormMessage, useFocusOnMount } from '../../../components/form';
import { nextNotice, type Notice } from '../content/shared';

export type AssessmentTab = 'settings' | 'questions' | 'rubric' | 'review';

export type Announce = (text: string, tone?: Notice['tone']) => void;

/** Where a published assessment stands for students right now. */
export function availability(
  assessment: Pick<AssessmentSummary, 'status' | 'opensAt' | 'dueAt'>,
  now: Date = new Date(),
): 'Draft' | 'Scheduled' | 'Open' | 'Closed' {
  if (assessment.status === 'draft') return 'Draft';
  if (assessment.dueAt && new Date(assessment.dueAt) <= now) return 'Closed';
  if (assessment.opensAt && new Date(assessment.opensAt) > now) return 'Scheduled';
  return 'Open';
}

const BADGE_STYLES: Record<ReturnType<typeof availability>, string> = {
  Draft: '',
  Scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  Open: 'border-green-200 bg-green-50 text-green-800',
  Closed: 'border-zinc-200 bg-zinc-50 text-zinc-700',
};

export function AvailabilityBadge({ assessment }: { assessment: AssessmentSummary }) {
  const state = availability(assessment);
  return state === 'Draft' ? (
    <Badge variant="secondary" className="rounded-full">
      Draft
    </Badge>
  ) : (
    <Badge variant="outline" className={`rounded-full ${BADGE_STYLES[state]}`}>
      {state}
    </Badge>
  );
}

const MANILA_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An instant as a `datetime-local` value in Philippine time (UTC+8, no daylight saving). */
export function toManilaInput(iso: string | null): string {
  if (!iso) return '';
  const parts = Object.fromEntries(
    MANILA_PARTS.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** A `datetime-local` value read as Philippine time; blank stays blank ("not set"). */
export function fromManilaInput(value: string): string {
  return value ? `${value}:00+08:00` : '';
}

interface FrameProps {
  readonly assessmentId: string;
  readonly title: string;
  readonly tab: AssessmentTab;
  readonly children: (details: AssessmentDetails, announce: Announce) => ReactNode;
}

/**
 * The frame of the T09–T12 editor: a way back, the h1 (focused when it appears), the class it
 * belongs to, tabs between the steps and the latest notice.
 */
export function AssessmentFrame({ assessmentId, title, tab, children }: FrameProps) {
  const result = useApiData<AssessmentDetails>(`/teacher/assessments/${assessmentId}`);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (result.status === 'loading') return <p role="status">Loading assessment…</p>;
  if (result.status === 'error') {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-3">
        <BackLink />
        <PageHeading title={title} />
        <FormMessage tone="error">{result.message}</FormMessage>
      </section>
    );
  }
  const details = result.data;
  const announce: Announce = (text, tone = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') result.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <BackLink />
      <PageHeading title={title} />
      <p className="mt-1 text-sm text-muted-foreground">
        Current term / {details.courseCode} – {details.courseTitle} · {details.sectionName}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {details.title} · {ASSESSMENT_KIND_LABELS[details.kind]}
        </span>
        <AvailabilityBadge assessment={details} />
      </p>
      <Tabs details={details} current={tab} />

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {result.refreshError && (
        <div className="mt-4">
          <FormMessage tone="error">
            Could not reload the assessment: {result.refreshError}
          </FormMessage>
        </div>
      )}
      {details.status === 'published' && tab !== 'review' && (
        <p className="mt-4 rounded-xl border border-orange-200 bg-accent px-4 py-3 text-sm">
          This assessment is published, so it is read-only.{' '}
          <Link
            to="/teacher/assessments/$assessmentId/review"
            params={{ assessmentId }}
            className="link"
          >
            Unpublish it on the review page
          </Link>{' '}
          to make changes.
        </p>
      )}
      <div className="mt-6">{children(details, announce)}</div>
    </section>
  );
}

function BackLink() {
  return (
    <p className="text-sm">
      <Link to="/teacher/assessments" className="link">
        Assessment management
      </Link>
    </p>
  );
}

function PageHeading({ title }: { title: string }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <h1
      ref={heading}
      id="page-title"
      tabIndex={-1}
      className="mt-2 text-2xl font-bold break-words outline-none"
    >
      {title}
    </h1>
  );
}

function Tabs({ details, current }: { details: AssessmentDetails; current: AssessmentTab }) {
  const params = { assessmentId: details.id };
  const tabs = [
    { tab: 'settings', label: 'Settings', to: '/teacher/assessments/$assessmentId' },
    usesQuestions(details.kind)
      ? { tab: 'questions', label: 'Questions', to: '/teacher/assessments/$assessmentId/questions' }
      : { tab: 'rubric', label: 'Rubric', to: '/teacher/assessments/$assessmentId/rubric' },
    { tab: 'review', label: 'Review and publish', to: '/teacher/assessments/$assessmentId/review' },
  ] as const;
  return (
    <nav aria-label="Assessment steps" className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <li key={item.tab}>
            <Link
              to={item.to}
              params={params}
              // Exact, or Settings (a prefix of the other steps) would count as current too.
              activeOptions={{ exact: true }}
              aria-current={item.tab === current ? 'page' : undefined}
              className="inline-block rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-brand-soft aria-[current=page]:border-orange-300 aria-[current=page]:bg-brand-soft aria-[current=page]:font-semibold aria-[current=page]:text-brand-strong"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * After a row is removed its button is gone, so focus moves to the first field or button left in
 * `container` instead of falling to the page.
 */
export function focusWithin(container: Element | null | undefined): void {
  requestAnimationFrame(() =>
    container?.querySelector<HTMLElement>('input, textarea, button:not([disabled])')?.focus(),
  );
}

/** "O1 – Explain dependencies" */
export function objectiveText(details: AssessmentDetails, objectiveId: string | null): string {
  const objective = details.courseObjectives.find((item) => item.id === objectiveId);
  return objective ? `${objective.code} – ${objective.description}` : 'No objective yet';
}
