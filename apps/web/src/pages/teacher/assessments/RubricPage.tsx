import { MAX_CRITERIA, MAX_LEVELS, type AssessmentDetails } from '@lead/schema';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '../../../auth/session';
import { FormMessage, SubmitButton, useFormAction } from '../../../components/form';
import { AssessmentFrame, focusWithin, type Announce } from './shared';

interface LevelRow {
  readonly key: number;
  readonly label: string;
  readonly points: string;
  readonly descriptor: string;
}

interface CriterionRow {
  readonly key: number;
  readonly name: string;
  readonly levels: readonly LevelRow[];
}

let nextKey = 1;
const newKey = () => nextKey++;

const defaultLevels = (): LevelRow[] =>
  [
    ['Strong', '4'],
    ['Developing', '2'],
    ['Needs work', '0'],
  ].map(([label = '', points = '']) => ({ key: newKey(), label, points, descriptor: '' }));

/** T11 Rubric and scoring criteria (assignments and projects). */
export function AssessmentRubricPage({ assessmentId }: { assessmentId: string }) {
  return (
    <AssessmentFrame assessmentId={assessmentId} title="Rubric and scoring criteria" tab="rubric">
      {(details, announce) => (
        <RubricForm
          // Starts again from the saved rubric once a save comes back.
          key={JSON.stringify([details.rubric, details.status])}
          details={details}
          announce={announce}
        />
      )}
    </AssessmentFrame>
  );
}

function RubricForm({ details, announce }: { details: AssessmentDetails; announce: Announce }) {
  const auth = useAuth();
  const readOnly = details.status === 'published';
  const [criteria, setCriteria] = useState<CriterionRow[]>(() =>
    details.rubric.map((criterion) => ({
      key: newKey(),
      name: criterion.name,
      levels: criterion.levels.map((level) => ({
        key: newKey(),
        label: level.label,
        points: String(level.points),
        descriptor: level.descriptor,
      })),
    })),
  );
  const { busy, error, onSubmit } = useFormAction(async () => {
    await auth.request(`/teacher/assessments/${details.id}/rubric`, {
      method: 'PUT',
      body: {
        criteria: criteria.map((criterion) => ({
          name: criterion.name,
          levels: criterion.levels.map(({ label, points, descriptor }) => ({
            label,
            points,
            descriptor,
          })),
        })),
      },
    });
    announce('Rubric saved.');
  });

  const total = criteria.reduce(
    (sum, criterion) =>
      sum + Math.max(0, ...criterion.levels.map((level) => Number(level.points) || 0)),
    0,
  );
  const changeCriterion = (key: number, change: (row: CriterionRow) => CriterionRow) =>
    setCriteria((rows) => rows.map((row) => (row.key === key ? change(row) : row)));
  const changeLevel = (criterionKey: number, levelKey: number, change: Partial<LevelRow>) =>
    changeCriterion(criterionKey, (row) => ({
      ...row,
      levels: row.levels.map((level) => (level.key === levelKey ? { ...level, ...change } : level)),
    }));

  const objectiveCodes = details.objectiveCodes.join(', ') || 'no objective yet';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {criteria.length === 0 && <p className="text-sm text-muted-foreground">No criteria yet.</p>}
      <fieldset disabled={readOnly} className="stagger flex flex-col gap-4">
        {criteria.map((criterion, index) => (
          <Card key={criterion.key} data-criterion className="card-interactive gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2">
                <h2 className="sr-only">Criterion {index + 1}</h2>
                <Input
                  value={criterion.name}
                  onChange={(event) =>
                    changeCriterion(criterion.key, (row) => ({ ...row, name: event.target.value }))
                  }
                  aria-label={`Criterion ${index + 1} name`}
                  placeholder="Criterion, e.g. Correctness"
                  required
                  maxLength={120}
                  className="h-10 rounded-xl font-semibold"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove criterion ${index + 1}`}
                    onClick={(event) => {
                      focusWithin(event.currentTarget.closest('form'));
                      setCriteria((rows) => rows.filter((row) => row.key !== criterion.key));
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
              {criterion.levels.map((level, levelIndex) => {
                const name = `criterion ${index + 1}, level ${levelIndex + 1}`;
                return (
                  <div
                    key={level.key}
                    className="grid grid-cols-[1fr_5rem_auto] gap-2 sm:grid-cols-[10rem_5rem_1fr_auto]"
                  >
                    <Input
                      value={level.label}
                      onChange={(event) =>
                        changeLevel(criterion.key, level.key, { label: event.target.value })
                      }
                      aria-label={`Label, ${name}`}
                      required
                      maxLength={60}
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={level.points}
                      onChange={(event) =>
                        changeLevel(criterion.key, level.key, { points: event.target.value })
                      }
                      aria-label={`Points, ${name}`}
                      required
                      className="h-10 rounded-xl"
                    />
                    <Input
                      value={level.descriptor}
                      onChange={(event) =>
                        changeLevel(criterion.key, level.key, { descriptor: event.target.value })
                      }
                      aria-label={`Descriptor, ${name}`}
                      placeholder="What this level looks like"
                      maxLength={500}
                      className="col-span-2 h-10 rounded-xl sm:col-span-1"
                    />
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${name}`}
                        disabled={criterion.levels.length <= 2}
                        onClick={(event) => {
                          focusWithin(event.currentTarget.closest('[data-criterion]'));
                          changeCriterion(criterion.key, (row) => ({
                            ...row,
                            levels: row.levels.filter((item) => item.key !== level.key),
                          }));
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {!readOnly && criterion.levels.length < MAX_LEVELS && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      changeCriterion(criterion.key, (row) => ({
                        ...row,
                        levels: [
                          ...row.levels,
                          { key: newKey(), label: '', points: '', descriptor: '' },
                        ],
                      }))
                    }
                  >
                    <Plus aria-hidden="true" /> Add level
                    <span className="sr-only"> to criterion {index + 1}</span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </fieldset>

      <Card className="gap-2 py-4">
        <CardContent className="flex flex-col gap-1 px-4 text-sm">
          <p className="font-semibold">
            Total: {total} points / Objective {objectiveCodes}
          </p>
          <p className="text-muted-foreground">
            A rubric is worth the best level of every criterion. Confirm it matches the assignment
            instructions; feedback drafted from it is released only after your review.
          </p>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={criteria.length >= MAX_CRITERIA}
            onClick={() =>
              setCriteria((rows) => [...rows, { key: newKey(), name: '', levels: defaultLevels() }])
            }
          >
            <Plus aria-hidden="true" /> Add criterion
          </Button>
          {criteria.length >= MAX_CRITERIA && (
            <p className="self-center text-xs text-muted-foreground">
              A rubric has at most {MAX_CRITERIA} criteria.
            </p>
          )}
          <SubmitButton busy={busy}>Save rubric</SubmitButton>
        </div>
      )}
    </form>
  );
}
