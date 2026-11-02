import {
  DIFFICULTIES,
  MAX_CHOICES,
  type AssessmentDetails,
  type Question,
  type QuestionKind,
} from '@lead/schema';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import {
  errorMessage,
  field,
  FormMessage,
  SELECT_CLASS,
  SubmitButton,
  TextField,
  useFocusOnMount,
  useFormAction,
} from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { AssessmentFrame, focusWithin, objectiveText, type Announce } from './shared';

const KIND_LABELS: Record<QuestionKind, string> = {
  multiple_choice: 'multiple choice',
  written: 'written response',
};

/** T10 Question and objective editor (quizzes and examinations). */
export function AssessmentQuestionsPage({ assessmentId }: { assessmentId: string }) {
  // The question being edited, or 'new'.
  const [editing, setEditing] = useState<string>('new');
  // Bumped on every save, so the form starts again even if the reload fails; reloads alone (say,
  // after moving another question) keep what is being typed.
  const [saves, setSaves] = useState(0);
  return (
    <AssessmentFrame
      assessmentId={assessmentId}
      title="Question and objective editor"
      tab="questions"
    >
      {(details, announce) => {
        const readOnly = details.status === 'published';
        const question = details.questions.find((item) => item.id === editing);
        return (
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <QuestionList
              details={details}
              readOnly={readOnly}
              onEdit={setEditing}
              announce={announce}
            />
            {!readOnly && (
              <QuestionEditor
                // A fresh form per question, and again once a save comes back.
                key={`${question?.id ?? 'new'}:${saves}`}
                details={details}
                question={question}
                onCancel={() => setEditing('new')}
                onSaved={(text) => {
                  setSaves((count) => count + 1);
                  setEditing('new');
                  announce(text);
                }}
              />
            )}
          </div>
        );
      }}
    </AssessmentFrame>
  );
}

interface ListProps {
  readonly details: AssessmentDetails;
  readonly readOnly: boolean;
  readonly onEdit: (questionId: string) => void;
  readonly announce: Announce;
}

function QuestionList({ details, readOnly, onEdit, announce }: ListProps) {
  const auth = useAuth();
  const move = async (question: Question, direction: 'up' | 'down') => {
    try {
      await auth.request(`/teacher/assessments/${details.id}/questions/${question.id}/move`, {
        method: 'POST',
        body: { direction },
      });
      announce(`Question moved ${direction}.`);
    } catch (error) {
      announce(errorMessage(error), 'error');
    }
  };

  if (details.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No questions yet.{readOnly ? '' : ' Write the first one with the form.'}
      </p>
    );
  }
  return (
    <ol className="stagger flex flex-col gap-3">
      {details.questions.map((question, index) => (
        <li key={question.id}>
          <Card className="card-interactive gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle>
                <h2 className="text-sm font-semibold">
                  Question {question.position} / {KIND_LABELS[question.kind]}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4 text-sm">
              <p className="break-words whitespace-pre-wrap">{question.prompt}</p>
              {question.choices.length > 0 && (
                <ul className="flex flex-col gap-1 pl-1">
                  {question.choices.map((choice, choiceIndex) => (
                    <li key={choice.id}>
                      {String.fromCharCode(65 + choiceIndex)} / {choice.text}
                      {choice.correct && (
                        <span className="ml-2 font-semibold text-green-800">[correct]</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground">
                {objectiveText(details, question.objectiveId)} · {question.points} point
                {question.points === 1 ? '' : 's'} · {question.difficulty}
              </p>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit question ${question.position}`}
                    onClick={() => onEdit(question.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move question ${question.position} up`}
                    disabled={index === 0}
                    onClick={() => void move(question, 'up')}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move question ${question.position} down`}
                    disabled={index === details.questions.length - 1}
                    onClick={() => void move(question, 'down')}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <FormDialog
                    trigger="Remove"
                    triggerVariant="ghost"
                    triggerLabel={`Remove question ${question.position}`}
                    title={`Remove question ${question.position}?`}
                    description="The questions after it move up one place."
                    submitLabel="Remove question"
                    onSubmit={async () => {
                      await auth.request(
                        `/teacher/assessments/${details.id}/questions/${question.id}/remove`,
                        { method: 'POST' },
                      );
                    }}
                    afterSave={() => announce(`Question ${question.position} removed.`)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}

/** Takes focus when an existing question opens in the editor, so the form is announced. */
function EditorHeading({ text }: { text: string }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <h2 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
      {text}
    </h2>
  );
}

interface ChoiceRow {
  readonly key: number;
  readonly text: string;
  readonly correct: boolean;
}

interface EditorProps {
  readonly details: AssessmentDetails;
  readonly question: Question | undefined;
  readonly onCancel: () => void;
  readonly onSaved: (text: string) => void;
}

function QuestionEditor({ details, question, onCancel, onSaved }: EditorProps) {
  const auth = useAuth();
  const promptId = useId();
  const kindId = useId();
  const objectiveId = useId();
  const difficultyId = useId();
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'multiple_choice');
  const [choices, setChoices] = useState<ChoiceRow[]>(() =>
    question && question.choices.length > 0
      ? question.choices.map((choice, key) => ({ key, text: choice.text, correct: choice.correct }))
      : [0, 1, 2, 3].map((key) => ({ key, text: '', correct: key === 0 })),
  );
  const objectives = details.courseObjectives.filter((objective) =>
    details.objectiveIds.includes(objective.id),
  );

  const { busy, error, onSubmit } = useFormAction(async (form) => {
    const body = {
      kind,
      prompt: field(form, 'prompt'),
      points: field(form, 'points'),
      difficulty: field(form, 'difficulty'),
      objectiveId: field(form, 'objectiveId'),
      choices: kind === 'written' ? [] : choices.map(({ text, correct }) => ({ text, correct })),
    };
    if (question) {
      await auth.request(`/teacher/assessments/${details.id}/questions/${question.id}`, {
        method: 'PUT',
        body,
      });
      onSaved(`Question ${question.position} saved.`);
    } else {
      await auth.request(`/teacher/assessments/${details.id}/questions`, { method: 'POST', body });
      onSaved('Question added.');
    }
  });

  const update = (key: number, change: Partial<ChoiceRow>) =>
    setChoices((rows) =>
      rows.map((row) =>
        row.key === key ? { ...row, ...change } : change.correct ? { ...row, correct: false } : row,
      ),
    );

  return (
    <Card className="card-interactive self-start">
      <CardHeader>
        <CardTitle>
          {question ? (
            <EditorHeading text={`Edit question ${question.position}`} />
          ) : (
            <h2 className="text-base font-semibold">New question</h2>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <div className="flex flex-col gap-2">
            <Label htmlFor={kindId}>Format</Label>
            <select
              id={kindId}
              value={kind}
              onChange={(event) => setKind(event.target.value as QuestionKind)}
              className={SELECT_CLASS}
            >
              <option value="multiple_choice">Multiple choice</option>
              <option value="written">Written response</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={promptId}>Question text</Label>
            <Textarea
              id={promptId}
              name="prompt"
              required
              maxLength={2000}
              rows={3}
              defaultValue={question?.prompt ?? ''}
              className="rounded-xl"
            />
          </div>
          {kind === 'multiple_choice' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                Answer choices (select the correct one)
              </legend>
              {choices.map((row, index) => {
                const letter = String.fromCharCode(65 + index);
                return (
                  <div key={row.key} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={row.correct}
                      onChange={() => update(row.key, { correct: true })}
                      aria-label={`Choice ${letter} is correct`}
                      className="size-4 accent-brand"
                    />
                    <Input
                      value={row.text}
                      onChange={(event) => update(row.key, { text: event.target.value })}
                      aria-label={`Choice ${letter}`}
                      required
                      maxLength={500}
                      className="h-10 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove choice ${letter}`}
                      disabled={choices.length <= 2}
                      onClick={(event) => {
                        focusWithin(event.currentTarget.closest('fieldset'));
                        setChoices((rows) => {
                          const rest = rows.filter((item) => item.key !== row.key);
                          return rest.some((item) => item.correct)
                            ? rest
                            : rest.map((item, i) => ({ ...item, correct: i === 0 }));
                        });
                      }}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
              {choices.length < MAX_CHOICES && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setChoices((rows) => [
                        ...rows,
                        {
                          key: Math.max(...rows.map((item) => item.key)) + 1,
                          text: '',
                          correct: false,
                        },
                      ])
                    }
                  >
                    <Plus aria-hidden="true" /> Add choice
                  </Button>
                </div>
              )}
            </fieldset>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor={objectiveId}>Objective</Label>
            <select
              id={objectiveId}
              name="objectiveId"
              defaultValue={question?.objectiveId ?? objectives[0]?.id ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">Not mapped yet</option>
              {objectives.map((objective) => (
                <option key={objective.id} value={objective.id}>
                  {objective.code} – {objective.description}
                </option>
              ))}
            </select>
            {objectives.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Choose the assessment's objectives on the Settings step first.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Points"
              name="points"
              type="number"
              min={1}
              max={100}
              required
              defaultValue={question?.points ?? 1}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor={difficultyId}>Difficulty</Label>
              <select
                id={difficultyId}
                name="difficulty"
                defaultValue={question?.difficulty ?? 'moderate'}
                className={SELECT_CLASS}
              >
                {DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {difficulty}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Required to publish: an objective, and for multiple choice an answer key.
          </p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton busy={busy}>{question ? 'Save question' : 'Add question'}</SubmitButton>
            {question && (
              <Button type="button" variant="outline" size="lg" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
