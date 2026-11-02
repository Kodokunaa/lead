import type { AssessmentDetails, ChecklistFix } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../../auth/session';
import { FormMessage, SubmitButton, useFormAction } from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { countOf, formatDateTime } from '../../../components/format';
import { AssessmentFrame, availability, type Announce } from './shared';

const FIX_LINKS = {
  settings: { to: '/teacher/assessments/$assessmentId', label: 'Fix in settings' },
  questions: { to: '/teacher/assessments/$assessmentId/questions', label: 'Fix the questions' },
  rubric: { to: '/teacher/assessments/$assessmentId/rubric', label: 'Fix the rubric' },
} as const satisfies Record<ChecklistFix, { to: string; label: string }>;

/** T12 Review, schedule and publish assessment. */
export function AssessmentReviewPage({ assessmentId }: { assessmentId: string }) {
  return (
    <AssessmentFrame
      assessmentId={assessmentId}
      title="Review, schedule and publish assessment"
      tab="review"
    >
      {(details, announce) => (
        <div className="stagger grid gap-4 lg:grid-cols-2">
          <Checklist details={details} />
          <Availability details={details} />
          <div className="lg:col-span-2">
            {details.status === 'draft' ? (
              <Publish details={details} announce={announce} />
            ) : (
              <Unpublish details={details} announce={announce} />
            )}
          </div>
        </div>
      )}
    </AssessmentFrame>
  );
}

function Checklist({ details }: { details: AssessmentDetails }) {
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Publication review / {details.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3 text-sm">
          {details.checklist.map((item) => {
            const fix = FIX_LINKS[item.fix];
            return (
              <li key={item.label} className="flex gap-2">
                {item.ok ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-green-700"
                  />
                ) : (
                  <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-700" />
                )}
                <div>
                  <p className="font-medium">
                    <span className="sr-only">{item.ok ? 'Passed: ' : 'Needs attention: '}</span>
                    {item.label}
                  </p>
                  <p className={item.ok ? 'text-muted-foreground' : 'text-red-800'}>
                    {item.detail}
                  </p>
                  {!item.ok && (
                    <Link to={fix.to} params={{ assessmentId: details.id }} className="link">
                      {fix.label}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function Availability({ details }: { details: AssessmentDetails }) {
  // For a draft, what publishing now would make it.
  const state = availability({ ...details, status: 'published' });
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Learner availability preview</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>
          {details.status === 'published' ? 'Status' : 'Status after publishing'}: {state}
        </p>
        <p>Opens: {details.opensAt ? formatDateTime(details.opensAt) : 'Not set'}</p>
        <p>Due: {details.dueAt ? formatDateTime(details.dueAt) : 'Not set'}</p>
        <p>
          For {details.courseCode} · {details.sectionName} only (
          {countOf(details.enrolled, 'enrolled student')})
        </p>
        <p>Points: {details.points}</p>
      </CardContent>
    </Card>
  );
}

function Publish({ details, announce }: { details: AssessmentDetails; announce: Announce }) {
  const auth = useAuth();
  const ready = details.checklist.every((item) => item.ok);
  const { busy, error, onSubmit } = useFormAction(async () => {
    await auth.request(`/teacher/assessments/${details.id}/publish`, { method: 'POST' });
    announce(`${details.title} published.`);
  });
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Confirm publication</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <p>
            {ready
              ? 'Publish only after reviewing the scoring and content. Students of the class see it from its opening date.'
              : 'Fix the items marked above before publishing.'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton busy={busy}>Confirm publish</SubmitButton>
            <Link
              to="/teacher/assessments/$assessmentId"
              params={{ assessmentId: details.id }}
              className="link"
            >
              Edit draft
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Unpublish({ details, announce }: { details: AssessmentDetails; announce: Announce }) {
  const auth = useAuth();
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Published</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          Published {details.publishedAt ? formatDateTime(details.publishedAt) : ''}. It appears in
          the class's assessment list.
        </p>
        <div>
          <FormDialog
            trigger="Unpublish"
            triggerVariant="outline"
            title={`Unpublish ${details.title}?`}
            description="Students will no longer see it, and you can edit it again as a draft."
            submitLabel="Unpublish"
            onSubmit={async () => {
              await auth.request(`/teacher/assessments/${details.id}/unpublish`, {
                method: 'POST',
              });
            }}
            afterSave={() => announce(`${details.title} is a draft again.`)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
