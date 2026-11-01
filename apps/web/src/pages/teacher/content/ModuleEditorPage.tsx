import type { ContentModule, CourseContent, Lesson } from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import {
  errorMessage,
  field,
  FormMessage,
  SubmitButton,
  TextField,
  useFormAction,
} from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { courseHeading, nextNotice, objectiveLabel, StatusBadge, type Notice } from './shared';

interface ModuleEditorProps {
  readonly courseId: string;
  readonly moduleId: string;
}

/** T05 Module and learning objective editor. */
export function ModuleEditorPage({ courseId, moduleId }: ModuleEditorProps) {
  const result = useApiData<CourseContent>(`/teacher/content/${courseId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Unsaved edits in the form; publishing uses the saved module, so it waits for a save.
  const [dirty, setDirty] = useState(false);

  if (result.status === 'loading') return <p role="status">Loading module…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const content = result.data;
  const module = content.modules.find((item) => item.id === moduleId);
  if (!module) return <NotFound courseId={courseId} what="module" />;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') result.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/teacher/content/$courseId" params={{ courseId }} className="link">
          Course outline
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Module and learning objective editor
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Current term · {courseHeading(content)}</p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {result.refreshError && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Could not refresh the module: {result.refreshError}
        </p>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ModuleForm
          // Remounts with the saved values (as the server normalized them) once they arrive.
          key={savedVersion(module)}
          content={content}
          module={module}
          onEdit={() => setDirty(true)}
          onSaved={() => {
            setDirty(false);
            announce('Changes saved.');
          }}
        />
        <ModuleStatus content={content} module={module} dirty={dirty} onChanged={announce} />
      </div>
    </section>
  );
}

function savedVersion(module: ContentModule): string {
  return JSON.stringify([
    module.id,
    module.title,
    module.description,
    module.objectiveIds,
    module.requiresPrevious,
    module.masteryThreshold,
  ]);
}

export function NotFound({ courseId, what }: { courseId: string; what: string }) {
  return (
    <section className="flex flex-col gap-3">
      <FormMessage tone="error">No such {what} in this course.</FormMessage>
      <p className="text-sm">
        <Link to="/teacher/content/$courseId" params={{ courseId }} className="link">
          Back to the course outline
        </Link>
      </p>
    </section>
  );
}

interface ModuleFormProps {
  readonly content: CourseContent;
  readonly module: ContentModule;
  readonly onEdit: () => void;
  readonly onSaved: () => void;
}

function ModuleForm({ content, module, onEdit, onSaved }: ModuleFormProps) {
  const auth = useAuth();
  const descriptionId = useId();
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/teacher/content/${content.course.id}/modules/${module.id}`, {
      method: 'PATCH',
      body: {
        title: field(form, 'title'),
        description: field(form, 'description'),
        objectiveIds: form.getAll('objectiveIds').filter((value) => typeof value === 'string'),
        requiresPrevious: form.get('requiresPrevious') === 'on',
        masteryThreshold: field(form, 'masteryThreshold'),
      },
    });
    onSaved();
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Details and configuration</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} onChange={onEdit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <TextField
            label="Module title"
            name="title"
            defaultValue={module.title}
            required
            maxLength={120}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea
              id={descriptionId}
              name="description"
              defaultValue={module.description}
              maxLength={1000}
              rows={3}
              className="rounded-xl"
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Learning objectives</legend>
            {content.objectives.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This course has no objectives yet.{' '}
                <Link
                  to="/teacher/content/$courseId"
                  params={{ courseId: content.course.id }}
                  className="link"
                >
                  Add them on the course outline.
                </Link>
              </p>
            ) : (
              content.objectives.map((objective) => (
                <label key={objective.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="objectiveIds"
                    value={objective.id}
                    defaultChecked={module.objectiveIds.includes(objective.id)}
                    className="mt-1 size-4 accent-brand"
                  />
                  {objectiveLabel(objective)}
                </label>
              ))
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Prerequisite / mastery condition</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="requiresPrevious"
                defaultChecked={module.requiresPrevious}
                className="size-4 accent-brand"
              />
              Students finish the previous module first
            </label>
            <TextField
              label="Mastery score (%)"
              name="masteryThreshold"
              type="number"
              min={50}
              max={100}
              defaultValue={module.masteryThreshold ?? ''}
              hint="Score that counts as mastered, 50–100. Leave blank for none."
            />
          </fieldset>
          <div>
            <SubmitButton busy={busy}>Save draft</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface ModuleStatusProps {
  readonly content: CourseContent;
  readonly module: ContentModule;
  readonly dirty: boolean;
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

function ModuleStatus({ content, module, dirty, onChanged }: ModuleStatusProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const courseId = content.course.id;
  const publishing = module.status === 'draft';

  const toggle = () => {
    if (busy) return;
    if (publishing && dirty) {
      onChanged('Save your changes before publishing.', 'error');
      return;
    }
    setBusy(true);
    auth
      .request(
        `/teacher/content/${courseId}/modules/${module.id}/${publishing ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      )
      .then(
        () =>
          onChanged(
            publishing ? `${module.title} is published.` : `${module.title} is a draft again.`,
          ),
        (caught: unknown) => onChanged(errorMessage(caught), 'error'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Context / status</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>Course: {content.course.code}</p>
        <p className="flex items-center gap-2">
          Status: <StatusBadge status={module.status} />
        </p>
        <p className="text-muted-foreground">
          Objectives are reused in assessments and mastery. Publishing needs at least one, saved.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={publishing ? 'default' : 'outline'}
            aria-disabled={busy}
            onClick={toggle}
          >
            {publishing ? 'Publish module' : 'Unpublish'}
          </Button>
          <FormDialog
            trigger={
              <>
                <Plus aria-hidden="true" /> Add lesson
              </>
            }
            triggerVariant="outline"
            title={`Add a lesson to ${module.title}`}
            description="It starts as a draft at the end of the module."
            submitLabel="Add lesson"
            onSubmit={async (form) => {
              const lesson = await auth.request<Lesson>(
                `/teacher/content/${courseId}/modules/${module.id}/lessons`,
                { body: { title: field(form, 'title') } },
              );
              await navigate({
                to: '/teacher/content/$courseId/lessons/$lessonId',
                params: { courseId, lessonId: lesson.id },
              });
            }}
          >
            <TextField label="Lesson title" name="title" required maxLength={120} />
          </FormDialog>
        </div>
      </CardContent>
    </Card>
  );
}
