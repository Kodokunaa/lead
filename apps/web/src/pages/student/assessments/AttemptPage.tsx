import type { AnswerSaved, AttemptQuestion, AttemptView } from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '../../../auth/api';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { errorMessage } from '../../../components/form';
import { PageShell, StateShell } from '../CoursePages';
import { formatRemaining, timeWarning, useRemaining } from './shared';

type Answer = { readonly choiceId: string | null; readonly text: string };
type Answers = Readonly<Record<string, Answer>>;
type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved'; readonly savedAt: string }
  | { readonly status: 'error'; readonly message: string };

/** Written answers are saved this long after the last keystroke (or when the field is left). */
const TYPING_PAUSE_MS = 800;
const TIME_OF_DAY = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export function isAnswered(answer: Answer | undefined): boolean {
  return answer !== undefined && (answer.choiceId !== null || answer.text.trim() !== '');
}

export function BackToAssessment({ assessmentId }: { assessmentId: string }) {
  return (
    <Link to="/student/assessments/$assessmentId" params={{ assessmentId }} className="link">
      Assessment instructions
    </Link>
  );
}

/** Loads an attempt and sends a submitted one to its result. */
export function useOpenAttempt(attemptId: string) {
  const result = useApiData<AttemptView>(`/student/attempts/${attemptId}`);
  const navigate = useNavigate();
  const submitted = result.status === 'ready' && result.data.status === 'submitted';
  useEffect(() => {
    if (submitted) {
      void navigate({
        to: '/student/attempts/$attemptId/result',
        params: { attemptId },
        replace: true,
      });
    }
  }, [submitted, attemptId, navigate]);
  return submitted ? ({ status: 'loading' } as const) : result;
}

/** Submits the attempt and opens its result; also used when time runs out. */
export function useSubmitAttempt(attemptId: string) {
  const auth = useAuth();
  const navigate = useNavigate();
  return async () => {
    await auth.request(`/student/attempts/${attemptId}/submit`, { method: 'POST' });
    await navigate({
      to: '/student/attempts/$attemptId/result',
      params: { attemptId },
      replace: true,
    });
  };
}

/** S09 Quiz or examination attempt: one question at a time, saved as you answer. */
export function AttemptPage({ attemptId }: { attemptId: string }) {
  const result = useOpenAttempt(attemptId);
  if (result.status !== 'ready') {
    return (
      <StateShell
        back={
          <Link to="/student/assessments" className="link">
            Assessments and activities
          </Link>
        }
        title="Quiz or examination attempt"
        state={result}
      />
    );
  }
  return <AttemptForm view={result.data} />;
}

function AttemptForm({ view }: { view: AttemptView }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const submitAttempt = useSubmitAttempt(view.id);
  const [answers, setAnswers] = useState<Answers>(() =>
    Object.fromEntries(
      view.answers.map((answer) => [
        answer.questionId,
        { choiceId: answer.choiceId, text: answer.text },
      ]),
    ),
  );
  const answersRef = useRef(answers);
  const [index, setIndex] = useState(0);
  // Focus moves to a question only once the student goes to another one.
  const [moved, setMoved] = useState(false);
  const go = (position: number) => {
    setMoved(true);
    setIndex(position);
  };
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  // Saves run one after another, so an older answer never lands after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const typing = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const unsaved = useRef(new Set<string>());
  const finishing = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const remaining = useRemaining(view.deadlineAt, view.serverNow);
  const question = view.questions[index]!;

  /** The attempt is over (time up, or submitted elsewhere): show the result. */
  const finish = () => {
    if (finishing.current) return;
    finishing.current = true;
    void navigate({
      to: '/student/attempts/$attemptId/result',
      params: { attemptId: view.id },
      replace: true,
    });
  };

  const saveAnswer = (questionId: string): Promise<void> => {
    queue.current = queue.current.then(async () => {
      const answer = answersRef.current[questionId] ?? { choiceId: null, text: '' };
      setSave({ status: 'saving' });
      try {
        const saved = await auth.request<AnswerSaved>(
          `/student/attempts/${view.id}/answers/${questionId}`,
          { method: 'PUT', body: answer },
        );
        unsaved.current.delete(questionId);
        setSave(
          unsaved.current.size > 0
            ? { status: 'error', message: 'Some answers have not been saved yet.' }
            : { status: 'saved', savedAt: saved.savedAt },
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code === undefined) {
          finish();
          return;
        }
        unsaved.current.add(questionId);
        setSave({ status: 'error', message: errorMessage(error) });
      }
    });
    return queue.current;
  };

  const update = (questionId: string, answer: Answer) => {
    answersRef.current = { ...answersRef.current, [questionId]: answer };
    setAnswers(answersRef.current);
  };

  const choose = (questionId: string, choiceId: string) => {
    update(questionId, { choiceId, text: '' });
    void saveAnswer(questionId);
  };

  const type = (questionId: string, text: string) => {
    update(questionId, { choiceId: null, text });
    clearTimeout(typing.current.get(questionId));
    typing.current.set(
      questionId,
      setTimeout(() => {
        typing.current.delete(questionId);
        void saveAnswer(questionId);
      }, TYPING_PAUSE_MS),
    );
  };

  /** Saves whatever is still waiting: answers being typed, and ones that failed. */
  const flush = () => {
    const waiting = new Set([...typing.current.keys(), ...unsaved.current]);
    for (const timer of typing.current.values()) clearTimeout(timer);
    typing.current.clear();
    for (const questionId of waiting) void saveAnswer(questionId);
    return queue.current;
  };

  // Time is up: save what is left, then submit (the server also closes it on its own).
  useEffect(() => {
    if (remaining > 0 || finishing.current) return;
    finishing.current = true;
    void flush()
      .then(submitAttempt)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 409) {
          // Already closed by the server.
          finishing.current = false;
          finish();
          return;
        }
        setSubmitError(errorMessage(error));
      });
    // flush and submitAttempt read refs; only the clock decides when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // Leaving the page (a link, the back button) still saves what was being typed.
  useEffect(() => {
    const pending = typing.current;
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.size > 0 || unsaved.current.size > 0) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      for (const [questionId, timer] of pending) {
        clearTimeout(timer);
        void saveAnswer(questionId);
      }
      pending.clear();
    };
    // saveAnswer reads refs only; this runs once, on leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Review only once every answer is saved; otherwise the error stays on screen. */
  const review = async () => {
    await flush();
    if (unsaved.current.size > 0) return;
    await navigate({ to: '/student/attempts/$attemptId/review', params: { attemptId: view.id } });
  };

  const retrySubmit = () => {
    setSubmitError(null);
    void submitAttempt().catch((error: unknown) => setSubmitError(errorMessage(error)));
  };

  const unanswered = view.questions.filter((item) => !isAnswered(answers[item.id])).length;
  const warning = remaining === 0 ? 'Time is up. Submitting your answers.' : timeWarning(remaining);

  return (
    <PageShell
      back={<BackToAssessment assessmentId={view.assessmentId} />}
      title="Quiz or examination attempt"
      subtitle={`${view.courseCode} · ${view.sectionName} · Attempt ${view.number} / ${view.title}`}
    >
      <p className="mt-3 text-sm font-semibold" role="timer" aria-live="off">
        Time remaining: {formatRemaining(remaining, view.deadlineAt)}
      </p>
      <p className="sr-only" aria-live="polite">
        {warning}
      </p>
      {submitError && (
        <div
          role="alert"
          className="mt-3 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm"
        >
          <p className="font-medium text-red-800">
            Time is up, but the submission could not be confirmed.
          </p>
          <p className="text-red-800">{submitError}</p>
          <div>
            <Button size="sm" variant="outline" onClick={retrySubmit}>
              Submit my answers
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_1fr]">
        <QuestionCard
          key={question.id}
          question={question}
          total={view.questions.length}
          answer={answers[question.id]}
          focusOnMount={moved}
          onChoose={(choiceId) => choose(question.id, choiceId)}
          onType={(text) => type(question.id, text)}
          onLeave={() => void flush()}
        />

        <div className="flex flex-col gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle>
                <h2 className="text-sm font-semibold">Attempt navigation</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ol className="grid grid-cols-5 gap-2">
                {view.questions.map((item, position) => {
                  const done = isAnswered(answers[item.id]);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => go(position)}
                        aria-current={position === index ? 'step' : undefined}
                        aria-label={`Question ${position + 1}, ${done ? 'answered' : 'not answered'}`}
                        className={`size-9 rounded-lg border text-sm transition-colors aria-[current=step]:ring-2 aria-[current=step]:ring-primary ${
                          done ? 'border-green-300 bg-green-50 text-green-900' : 'bg-background'
                        }`}
                      >
                        {position + 1}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle>
                <h2 className="text-sm font-semibold">Status / policy</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 px-4 text-sm">
              <SaveStatus save={save} onRetry={() => void flush()} />
              <p>Unanswered: {unanswered === 1 ? '1 question' : `${unanswered} questions`}</p>
              <p>AI during attempt: disabled</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" size="lg" disabled={index === 0} onClick={() => go(index - 1)}>
          Previous question
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={index === view.questions.length - 1}
          onClick={() => go(index + 1)}
        >
          Next question
        </Button>
        <Button size="lg" onClick={() => void review()}>
          Review attempt
        </Button>
      </div>
    </PageShell>
  );
}

function SaveStatus({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.status === 'error') {
    // X02: keep the attempt on screen and offer a retry.
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-2"
      >
        <p className="font-medium text-red-800">Your most recent answer has not been saved.</p>
        <p className="text-red-800">{save.message}</p>
        <div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry saving
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p>
      {save.status === 'saving'
        ? 'Saving…'
        : save.status === 'saved'
          ? `Saved at ${TIME_OF_DAY.format(new Date(save.savedAt))}`
          : 'Answers are saved as you go.'}
    </p>
  );
}

interface QuestionCardProps {
  readonly question: AttemptQuestion;
  readonly total: number;
  readonly answer: Answer | undefined;
  readonly focusOnMount: boolean;
  readonly onChoose: (choiceId: string) => void;
  readonly onType: (text: string) => void;
  readonly onLeave: () => void;
}

function QuestionCard({
  question,
  total,
  answer,
  focusOnMount,
  onChoose,
  onType,
  onLeave,
}: QuestionCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const answerId = useId();
  const promptId = useId();
  // Moving to another question lands on it (the first question keeps the page title's focus).
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
    // Only when this question appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="animate-fade">
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
            Question {question.position} of {total}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {question.points} point{question.points === 1 ? '' : 's'}
            </span>
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p id={promptId} className="break-words whitespace-pre-wrap">
          {question.prompt}
        </p>
        {question.kind === 'multiple_choice' ? (
          <fieldset aria-labelledby={promptId} className="flex flex-col gap-2">
            {question.choices.map((choice) => (
              <label
                key={choice.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors hover:bg-brand-soft has-[:checked]:border-orange-300 has-[:checked]:bg-brand-soft"
              >
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={choice.id}
                  checked={answer?.choiceId === choice.id}
                  onChange={() => onChoose(choice.id)}
                  className="mt-1 size-4 accent-brand"
                />
                <span className="break-words">{choice.text}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={answerId}>Your answer</Label>
            <Textarea
              id={answerId}
              value={answer?.text ?? ''}
              onChange={(event) => onType(event.target.value)}
              onBlur={onLeave}
              maxLength={10_000}
              rows={8}
              className="rounded-xl"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
