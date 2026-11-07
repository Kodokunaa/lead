import type { AttemptView } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage, FormMessage, SubmitButton, useFormAction } from '../../../components/form';
import { PageShell, StateShell } from '../CoursePages';
import { BackToAssessment, isAnswered, useOpenAttempt, useSubmitAttempt } from './AttemptPage';
import { formatRemaining, useRemaining } from './shared';

const RANGE = 5;

/** S10 Review and submit attempt. */
export function AttemptReviewPage({ attemptId }: { attemptId: string }) {
  const result = useOpenAttempt(attemptId);
  if (result.status !== 'ready') {
    return (
      <StateShell
        back={
          <Link to="/student/assessments" className="link">
            Assessments and activities
          </Link>
        }
        title="Review and submit attempt"
        state={result}
      />
    );
  }
  return <Review view={result.data} />;
}

function Review({ view }: { view: AttemptView }) {
  const submit = useSubmitAttempt(view.id);
  const remaining = useRemaining(view.deadlineAt, view.serverNow);
  const { busy, error, onSubmit } = useFormAction(submit);
  const timeUp = useRef(false);
  const [timeUpError, setTimeUpError] = useState<string | null>(null);
  useEffect(() => {
    if (remaining > 0 || timeUp.current) return;
    timeUp.current = true;
    void submit().catch((failure: unknown) =>
      setTimeUpError(
        `Time is up, but the submission could not be confirmed. ${errorMessage(failure)} Use Confirm submit to try again.`,
      ),
    );
    // Only the clock decides when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const answers = new Map(view.answers.map((answer) => [answer.questionId, answer]));
  const ranges = [];
  for (let start = 0; start < view.questions.length; start += RANGE) {
    const questions = view.questions.slice(start, start + RANGE);
    const missing = questions.filter((question) => !isAnswered(answers.get(question.id)));
    ranges.push({
      label: `${start + 1}–${start + questions.length}`,
      answered: questions.length - missing.length,
      total: questions.length,
      missing: missing.map((question) => question.position),
    });
  }
  const unanswered = ranges.reduce((total, range) => total + range.missing.length, 0);

  return (
    <PageShell
      back={<BackToAssessment assessmentId={view.assessmentId} />}
      title="Review and submit attempt"
      subtitle={`${view.courseCode} · ${view.sectionName} · Attempt ${view.number} / ${view.title}`}
    >
      <p className="mt-3 text-sm font-semibold" role="timer" aria-live="off">
        Time remaining: {formatRemaining(remaining, view.deadlineAt)}
      </p>
      <Card className="animate-rise mt-4 gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Questions
              </TableHead>
              <TableHead scope="col">Answered</TableHead>
              <TableHead scope="col">Needs attention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranges.map((range) => (
              <TableRow key={range.label}>
                <th scope="row" className="px-4 text-left font-medium">
                  {range.label}
                </th>
                <TableCell>
                  {range.answered} of {range.total}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {range.missing.length === 0
                    ? 'None'
                    : `Question${range.missing.length === 1 ? '' : 's'} ${range.missing.join(', ')} unanswered`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="card-interactive mt-4">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Confirm final submission</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
            {(error ?? timeUpError) && (
              <FormMessage tone="error">{error ?? timeUpError}</FormMessage>
            )}
            <p>
              {unanswered === 0
                ? 'Every question has an answer.'
                : `${unanswered === 1 ? '1 question is' : `${unanswered} questions are`} unanswered. Return to them or submit now.`}{' '}
              Your saved answers will be submitted, and they cannot be changed afterwards.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton busy={busy}>Confirm submit</SubmitButton>
              <Link
                to="/student/attempts/$attemptId"
                params={{ attemptId: view.id }}
                className="link"
              >
                Return to questions
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
