import { usesQuestions, type AssessmentDetails } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import {
  field,
  FormMessage,
  SubmitButton,
  TextField,
  useFormAction,
} from '../../../components/form';
import { AssessmentFrame, fromManilaInput, toManilaInput, type Announce } from './shared';

/** T09 Assessment settings: title, dates, time and attempts, objectives. */
export function AssessmentSettingsPage({ assessmentId }: { assessmentId: string }) {
  return (
    <AssessmentFrame assessmentId={assessmentId} title="Assessment settings" tab="settings">
      {(details, announce) => (
        <div className="stagger grid gap-4 lg:grid-cols-[2fr_1fr]">
          <SettingsForm
            // Remounts with the saved values (as the server normalized them) once they arrive.
            key={savedVersion(details)}
            details={details}
            announce={announce}
          />
          <Context details={details} />
        </div>
      )}
    </AssessmentFrame>
  );
}

function savedVersion(details: AssessmentDetails): string {
  return JSON.stringify([
    details.title,
    details.instructions,
    details.opensAt,
    details.dueAt,
    details.timeLimitMinutes,
    details.maxAttempts,
    details.objectiveIds,
    details.status,
  ]);
}

function SettingsForm({ details, announce }: { details: AssessmentDetails; announce: Announce }) {
  const auth = useAuth();
  const instructionsId = useId();
  const readOnly = details.status === 'published';
  const timed = usesQuestions(details.kind);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/teacher/assessments/${details.id}`, {
      method: 'PATCH',
      body: {
        title: field(form, 'title'),
        instructions: field(form, 'instructions'),
        opensAt: fromManilaInput(field(form, 'opensAt')),
        dueAt: fromManilaInput(field(form, 'dueAt')),
        ...(timed ? { timeLimitMinutes: field(form, 'timeLimitMinutes') } : {}),
        maxAttempts: field(form, 'maxAttempts'),
        objectiveIds: form.getAll('objectiveIds').filter((value) => typeof value === 'string'),
      },
    });
    announce('Changes saved.');
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Details and configuration</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <TextField
              label="Title"
              name="title"
              defaultValue={details.title}
              required
              maxLength={120}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor={instructionsId}>Instructions for students</Label>
              <Textarea
                id={instructionsId}
                name="instructions"
                defaultValue={details.instructions}
                maxLength={5000}
                rows={4}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Opens (Philippine time)"
                name="opensAt"
                type="datetime-local"
                defaultValue={toManilaInput(details.opensAt)}
              />
              <TextField
                label="Due (Philippine time)"
                name="dueAt"
                type="datetime-local"
                defaultValue={toManilaInput(details.dueAt)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {timed && (
                <TextField
                  label="Time limit in minutes"
                  hint="Leave blank for no time limit."
                  name="timeLimitMinutes"
                  type="number"
                  min={1}
                  max={600}
                  defaultValue={details.timeLimitMinutes ?? ''}
                />
              )}
              <TextField
                label={timed ? 'Allowed attempts' : 'Allowed submissions'}
                name="maxAttempts"
                type="number"
                min={1}
                max={10}
                required
                defaultValue={details.maxAttempts}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Objective mapping</legend>
              {details.courseObjectives.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This course has no objectives yet.{' '}
                  <Link
                    to="/teacher/content/$courseId"
                    params={{ courseId: details.courseId }}
                    className="link"
                  >
                    Add them on the course outline.
                  </Link>
                </p>
              ) : (
                details.courseObjectives.map((objective) => (
                  <label key={objective.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="objectiveIds"
                      value={objective.id}
                      defaultChecked={details.objectiveIds.includes(objective.id)}
                      className="mt-1 size-4 accent-brand"
                    />
                    {objective.code} – {objective.description}
                  </label>
                ))
              )}
            </fieldset>
          </fieldset>
          {!readOnly && (
            <div>
              <SubmitButton busy={busy}>Save draft</SubmitButton>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Context({ details }: { details: AssessmentDetails }) {
  const params = { assessmentId: details.id };
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Context / status</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          {usesQuestions(details.kind)
            ? 'Formats: multiple choice and written response.'
            : 'Students submit a file, scored with the rubric.'}
        </p>
        <p>Points: {details.points}</p>
        <p>AI during attempt: disabled (institutional policy).</p>
        <p className="text-muted-foreground">
          Grade weights follow the institutional grading policy.
        </p>
        <p className="flex flex-col gap-1">
          {usesQuestions(details.kind) ? (
            <Link
              to="/teacher/assessments/$assessmentId/questions"
              params={params}
              className="link"
            >
              Questions
            </Link>
          ) : (
            <Link to="/teacher/assessments/$assessmentId/rubric" params={params} className="link">
              Rubric
            </Link>
          )}
          <Link to="/teacher/assessments/$assessmentId/review" params={params} className="link">
            Review and publish
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
