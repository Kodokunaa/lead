import {
  ASSESSMENT_KIND_LABELS,
  type GradedAttempt,
  type GradedQuestion,
  type GradingView,
  type SubmissionFile,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { downloadFile } from '../../../components/download';
import {
  errorMessage,
  field,
  FormMessage,
  SubmitButton,
  useFocusOnMount,
  useFormAction,
} from '../../../components/form';
import { formatDateTime } from '../../../components/format';
import { formatBytes } from '../../resources/shared';
import { nextNotice, type Notice } from '../content/shared';

interface Props {
  readonly assessmentId: string;
  readonly studentId: string;
}

function BackToQueue() {
  return (
    <Link to="/teacher/grading" className="link">
      Submissions and grading queue
    </Link>
  );
}

/** T14 Submission review and grading, with reasoned changes to a released grade (X05). */
export function GradingPage({ assessmentId, studentId }: Props) {
  const result = useApiData<GradingView>(`/teacher/grading/${assessmentId}/students/${studentId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (result.status !== 'ready') {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-3">
        <p className="text-sm">
          <BackToQueue />
        </p>
        <Heading />
        {result.status === 'loading' ? (
          <p role="status">Loading…</p>
        ) : (
          <FormMessage tone="error">{result.message}</FormMessage>
        )}
      </section>
    );
  }
  const view = result.data;
  const latest = view.submissions[0];
  // What the grade is for: the latest submission, or the quiz attempt.
  const targetId = view.attempt?.id ?? latest?.id;
  const announce = (text: string) => {
    setNotice((previous) => nextNotice(previous, text));
    result.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-6xl">
      <p className="text-sm">
        <BackToQueue />
      </p>
      <Heading />
      <p className="mt-1 text-sm text-muted-foreground">
        {view.courseCode} – {view.courseTitle} · {view.sectionName} · {view.title} (
        {ASSESSMENT_KIND_LABELS[view.kind].toLowerCase()})
      </p>
      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {result.refreshError && (
        <div className="mt-4">
          <FormMessage tone="error">Could not reload: {result.refreshError}</FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">
                {view.student.name} / {view.attempt ? 'quiz attempt' : 'submitted file'}
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {view.attempt ? (
              <>
                <p>
                  Attempt {view.attempt.number}, submitted{' '}
                  {formatDateTime(view.attempt.submittedAt)}
                  {view.attempt.autoSubmitted ? ' (time ran out)' : ''}
                </p>
                <p>
                  Multiple choice, scored on submission: {view.attempt.score} /{' '}
                  {view.attempt.scoredPoints}
                </p>
              </>
            ) : !latest ? (
              <p>
                {view.kind === 'assignment' || view.kind === 'project'
                  ? 'No submission yet.'
                  : 'No submitted attempt yet.'}
              </p>
            ) : (
              <>
                <SubmissionLine view={view} file={latest} />
                {view.submissions.length > 1 && (
                  <div>
                    <h3 className="font-medium">Submission history</h3>
                    <ul className="mt-1 flex flex-col gap-2">
                      {view.submissions.slice(1).map((item) => (
                        <li key={item.id}>
                          <SubmissionLine view={view} file={item} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {targetId ? (
          <GradeForm
            // A fresh form once a save comes back.
            key={view.grade?.gradedAt ?? 'none'}
            view={view}
            targetId={targetId}
            onSaved={announce}
          />
        ) : null}
      </div>
    </section>
  );
}

function Heading() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <h1
      ref={heading}
      id="page-title"
      tabIndex={-1}
      className="mt-2 text-2xl font-bold outline-none"
    >
      Submission review and grading
    </h1>
  );
}

function SubmissionLine({ view, file }: { view: GradingView; file: SubmissionFile }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <p>
        Version {file.number}:{' '}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-brand-strong"
          aria-label={`Download ${file.fileName}, version ${file.number}`}
          onClick={() => {
            setError(null);
            void downloadFile(
              auth,
              `/teacher/grading/${view.assessmentId}/submissions/${file.id}/file`,
              file.fileName,
            ).catch((failure: unknown) => setError(errorMessage(failure)));
          }}
        >
          {file.fileName}
        </Button>{' '}
        ({formatBytes(file.sizeBytes)})
      </p>
      <p className="text-muted-foreground">
        Submitted {file.submittedAt ? formatDateTime(file.submittedAt) : '—'} /{' '}
        {file.late ? 'late' : 'within deadline'}
      </p>
      {file.note && <p className="break-words whitespace-pre-wrap">Note: {file.note}</p>}
      {error && (
        <p role="alert" className="font-medium text-red-800">
          Download failed: {error}
        </p>
      )}
    </div>
  );
}

interface GradeFormProps {
  readonly view: GradingView;
  /** The submission or attempt being graded. */
  readonly targetId: string;
  readonly onSaved: (text: string) => void;
}

function GradeForm({ view, targetId, onSaved }: GradeFormProps) {
  const auth = useAuth();
  const feedbackId = useId();
  const reasonId = useId();
  const [chosen, setChosen] = useState<Record<string, string>>(() => ({ ...view.grade?.levels }));
  const released = view.grade?.status === 'released';
  // Written-question points as typed, { questionId: "4" }.
  const stale =
    view.grade !== null && (view.grade.submissionId ?? view.grade.attemptId) !== targetId;
  // The written questions of this attempt; points always refer to these only.
  const written = (view.attempt?.questions ?? []).filter((question) => question.kind === 'written');
  // A grade of an earlier attempt does not carry its points over to new answers.
  const [given, setGiven] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      stale
        ? []
        : written.flatMap((question) => {
            const points = view.grade?.questionPoints[question.id];
            return points === undefined ? [] : [[question.id, String(points)]];
          }),
    ),
  );
  const total = view.attempt
    ? view.attempt.score +
      written.reduce((sum, question) => sum + (Number(given[question.id]) || 0), 0)
    : view.rubric.reduce((sum, criterion) => {
        const level = criterion.levels.find((item) => item.id === chosen[criterion.id]);
        return sum + (level?.points ?? 0);
      }, 0);

  // Which button sent the form: "Save draft grade" or "Release grade and feedback".
  const releasing = useRef(false);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    const release = releasing.current;
    await auth.request(`/teacher/grading/${view.assessmentId}/students/${view.student.id}`, {
      method: 'PUT',
      body: {
        levels: view.attempt ? {} : chosen,
        questionPoints: Object.fromEntries(
          written.map((question) => [question.id, Number(given[question.id])]),
        ),
        feedback: field(form, 'feedback'),
        release,
        reason: field(form, 'reason'),
      },
    });
    onSaved(
      released
        ? 'Grade changed and recorded.'
        : release
          ? 'Grade and feedback released.'
          : 'Draft grade saved.',
    );
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Teacher evaluation</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {stale && (
            <p className="rounded-xl border border-orange-200 bg-accent px-3 py-2 text-sm">
              The student {view.attempt ? 'took the quiz again' : 'submitted a newer version'} since
              this grade was saved; the newest one is graded now.
            </p>
          )}
          {view.attempt && (
            <QuizScoring
              attempt={view.attempt}
              given={given}
              onChange={(questionId, points) =>
                setGiven((current) => ({ ...current, [questionId]: points }))
              }
            />
          )}
          {view.rubric.map((criterion) => (
            <fieldset key={criterion.id} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{criterion.name}</legend>
              <div className="flex flex-wrap gap-2">
                {criterion.levels.map((level) => (
                  <label
                    key={level.id}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-orange-300 has-[:checked]:bg-brand-soft"
                  >
                    <input
                      type="radio"
                      name={`criterion-${criterion.id}`}
                      checked={chosen[criterion.id] === level.id}
                      onChange={() =>
                        setChosen((current) => ({ ...current, [criterion.id]: level.id }))
                      }
                      required
                      className="size-4 accent-brand"
                    />
                    <span>
                      {level.label} / {level.points}
                      {level.descriptor && (
                        <span className="block text-xs text-muted-foreground">
                          {level.descriptor}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="font-semibold">
            Total: {total} / {view.points}
          </p>
          <p className="text-xs text-muted-foreground">
            {view.attempt
              ? 'Give points for every written answer; multiple choice is already scored.'
              : 'Choose a level for every criterion.'}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor={feedbackId}>Feedback</Label>
            <Textarea
              id={feedbackId}
              name="feedback"
              defaultValue={view.grade?.feedback ?? ''}
              maxLength={5000}
              rows={4}
              className="rounded-xl"
            />
          </div>
          {released && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={reasonId}>Reason for changing a released grade</Label>
              <Textarea
                id={reasonId}
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={2}
                className="rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                The student already sees this grade. The change and your reason are recorded in the
                audit log.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            AI-drafted feedback arrives in a later phase; any draft must be reviewed before release.
          </p>
          <div className="flex flex-wrap gap-2">
            {released ? (
              <SubmitButton busy={busy}>Confirm grade change</SubmitButton>
            ) : (
              <>
                <Button
                  type="submit"
                  size="lg"
                  aria-disabled={busy}
                  aria-busy={busy}
                  onClick={() => (releasing.current = false)}
                >
                  Save draft grade
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  variant="outline"
                  aria-disabled={busy}
                  aria-busy={busy}
                  onClick={() => (releasing.current = true)}
                >
                  Release grade and feedback
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface QuizScoringProps {
  readonly attempt: GradedAttempt;
  readonly given: Readonly<Record<string, string>>;
  readonly onChange: (questionId: string, points: string) => void;
}

/** Each question of the attempt: multiple choice as scored, written ones with a points box. */
function QuizScoring({ attempt, given, onChange }: QuizScoringProps) {
  return (
    <ol className="flex flex-col gap-3">
      {attempt.questions.map((question) => (
        <li key={question.id} className="rounded-xl border p-3 text-sm">
          <p className="font-medium">
            Question {question.position} ({question.points} point
            {question.points === 1 ? '' : 's'})
          </p>
          <p className="mt-1 break-words whitespace-pre-wrap">{question.prompt}</p>
          {question.kind === 'multiple_choice' ? (
            <p className="mt-2">
              {question.answer === null ? (
                'Not answered'
              ) : (
                <>
                  Answer: {question.answer} ·{' '}
                  <span className={question.correct ? 'text-green-800' : 'text-red-800'}>
                    {question.correct ? 'correct' : 'incorrect'}
                  </span>
                </>
              )}{' '}
              · {question.awarded ?? 0} / {question.points}
            </p>
          ) : (
            <WrittenAnswer
              question={question}
              value={given[question.id] ?? ''}
              onChange={(points) => onChange(question.id, points)}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function WrittenAnswer({
  question,
  value,
  onChange,
}: {
  question: GradedQuestion;
  value: string;
  onChange: (points: string) => void;
}) {
  const pointsId = useId();
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="rounded-lg bg-muted/40 p-2 break-words whitespace-pre-wrap">
        {question.answer ?? 'No answer was given.'}
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor={pointsId}>
          Points for question {question.position} (out of {question.points})
        </Label>
        <Input
          id={pointsId}
          type="number"
          min={0}
          max={question.points}
          step={1}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-20 rounded-lg"
        />
      </div>
    </div>
  );
}
