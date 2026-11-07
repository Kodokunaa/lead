import {
  ASSESSMENT_KIND_LABELS,
  type AttemptView,
  type StudentAssessmentDetails,
} from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { FormMessage, SubmitButton, useFormAction } from '../../../components/form';
import { countOf, formatDateTime } from '../../../components/format';
import { PageShell, StateShell } from '../CoursePages';
import { StateBadge } from './shared';

function BackToAssessments() {
  return (
    <Link to="/student/assessments" className="link">
      Assessments and activities
    </Link>
  );
}

/** S08 Assessment instructions: what it covers, the attempt policy, and Begin. */
export function StudentAssessmentPage({ assessmentId }: { assessmentId: string }) {
  const result = useApiData<StudentAssessmentDetails>(`/student/assessments/${assessmentId}`);
  if (result.status !== 'ready') {
    return (
      <StateShell back={<BackToAssessments />} title="Assessment instructions" state={result} />
    );
  }
  const details = result.data;
  return (
    <PageShell
      back={<BackToAssessments />}
      title="Assessment instructions"
      subtitle={`${details.courseCode} – ${details.courseTitle} · ${details.sectionName}`}
    >
      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                {details.title} · {ASSESSMENT_KIND_LABELS[details.kind]}
                <StateBadge state={details.state} />
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {details.objectives.map((objective) => (
              <p key={objective.code}>
                Objective: {objective.code} / {objective.description}
              </p>
            ))}
            <p>
              {countOf(details.questionCount, 'question')} / {countOf(details.points, 'point')} /{' '}
              {details.timeLimitMinutes
                ? countOf(details.timeLimitMinutes, 'minute')
                : 'no time limit'}
            </p>
            <p>
              Available: {formatDateTime(details.opensAt)} to {formatDateTime(details.dueAt)}
            </p>
            <p>
              Attempts used: {details.attemptsUsed} of {details.maxAttempts} (set by your teacher)
            </p>
            {details.instructions && (
              <p className="mt-2 break-words whitespace-pre-wrap">{details.instructions}</p>
            )}
          </CardContent>
        </Card>

        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Before you begin</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>The AI assistant is off during the attempt.</li>
              <li>
                Stay connected: each answer is saved as you go, and the page shows when it was.
              </li>
              <li>
                {details.timeLimitMinutes
                  ? 'The timer keeps running if you leave the page; when it ends, your saved answers are submitted.'
                  : 'When the assessment closes, your saved answers are submitted.'}
              </li>
              <li>Review all answers before the final submission.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Begin details={details} />
        {details.attempts.some((attempt) => attempt.status === 'submitted') && (
          <section aria-labelledby="past-attempts" className="text-sm">
            <h2 id="past-attempts" className="font-semibold">
              Your attempts
            </h2>
            <ul className="mt-1 flex flex-col gap-1">
              {details.attempts
                .filter((attempt) => attempt.status === 'submitted')
                .map((attempt) => (
                  <li key={attempt.id}>
                    <Link
                      to="/student/attempts/$attemptId/result"
                      params={{ attemptId: attempt.id }}
                      className="link"
                    >
                      Attempt {attempt.number} result
                    </Link>{' '}
                    · submitted {formatDateTime(attempt.submittedAt!)}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </PageShell>
  );
}

function Begin({ details }: { details: StudentAssessmentDetails }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const inProgress = details.state === 'in_progress';
  const { busy, error, onSubmit } = useFormAction(async () => {
    const attempt = await auth.request<AttemptView>(`/student/assessments/${details.id}/attempts`, {
      method: 'POST',
    });
    await navigate({ to: '/student/attempts/$attemptId', params: { attemptId: attempt.id } });
  });

  if (!inProgress && details.blockedReason) {
    return (
      <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">{details.blockedReason}</p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div>
        <SubmitButton busy={busy}>
          {inProgress ? 'Continue attempt' : `Begin attempt ${details.attemptsUsed + 1}`}
        </SubmitButton>
      </div>
    </form>
  );
}
