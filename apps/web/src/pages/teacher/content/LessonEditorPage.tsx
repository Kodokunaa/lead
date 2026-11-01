import { MAX_LESSON_BODY, type CourseContent, type Lesson } from '@lead/schema';
import { Link } from '@tanstack/react-router';
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
  SELECT_CLASS,
  SubmitButton,
  TextField,
  useFormAction,
} from '../../../components/form';
import { NotFound } from './ModuleEditorPage';
import { courseHeading, nextNotice, objectiveLabel, StatusBadge, type Notice } from './shared';

interface LessonEditorProps {
  readonly courseId: string;
  readonly lessonId: string;
}

/** T06 Lesson editor and publication. */
export function LessonEditorPage({ courseId, lessonId }: LessonEditorProps) {
  const content = useApiData<CourseContent>(`/teacher/content/${courseId}`);
  const lesson = useApiData<Lesson>(`/teacher/content/${courseId}/lessons/${lessonId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Unsaved edits in the form; publishing uses the saved lesson, so it waits for a save.
  const [dirty, setDirty] = useState(false);

  if (content.status === 'loading' || lesson.status === 'loading') {
    return <p role="status">Loading lesson…</p>;
  }
  if (content.status === 'error') return <FormMessage tone="error">{content.message}</FormMessage>;
  if (lesson.status === 'error') return <FormMessage tone="error">{lesson.message}</FormMessage>;
  const module = content.data.modules.find((item) => item.id === lesson.data.moduleId);
  if (!module) return <NotFound courseId={courseId} what="lesson" />;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') {
      lesson.reload();
      content.reload();
    }
  };

  return (
    <section aria-labelledby="page-title" className="max-w-6xl">
      <p className="text-sm">
        <Link to="/teacher/content/$courseId" params={{ courseId }} className="link">
          Course outline
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Lesson editor and publication
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Current term · {courseHeading(content.data)}
      </p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {content.refreshError || lesson.refreshError ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Could not refresh the lesson: {lesson.refreshError ?? content.refreshError}
        </p>
      ) : null}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[1fr_3fr]">
        <Card className="card-interactive self-start">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Module outline</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {module.position} / {module.title}
            </p>
            <ol aria-label={`Lessons in ${module.title}`} className="mt-2 flex flex-col gap-1">
              {module.lessons.map((item) => (
                <li key={item.id} className="text-sm">
                  {item.id === lessonId ? (
                    <span aria-current="page" className="font-semibold text-brand-strong">
                      {item.position}. {item.title}
                    </span>
                  ) : (
                    <Link
                      to="/teacher/content/$courseId/lessons/$lessonId"
                      params={{ courseId, lessonId: item.id }}
                      className="link"
                    >
                      {item.position}. {item.title}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <LessonForm
            // Remounts with the saved values once they arrive.
            key={`${lesson.data.id}:${lesson.data.updatedAt}`}
            content={content.data}
            lesson={lesson.data}
            moduleObjectiveIds={module.objectiveIds}
            onEdit={() => setDirty(true)}
            onSaved={() => {
              setDirty(false);
              announce('Lesson saved.');
            }}
          />
          <LessonStatus
            courseId={courseId}
            courseCode={content.data.course.code}
            lesson={lesson.data}
            dirty={dirty}
            onChanged={announce}
          />
        </div>
      </div>
    </section>
  );
}

interface LessonFormProps {
  readonly content: CourseContent;
  readonly lesson: Lesson;
  readonly moduleObjectiveIds: readonly string[];
  readonly onEdit: () => void;
  readonly onSaved: () => void;
}

function LessonForm({ content, lesson, moduleObjectiveIds, onEdit, onSaved }: LessonFormProps) {
  const auth = useAuth();
  const objectiveId = useId();
  const bodyId = useId();
  const choices = content.objectives.filter((objective) =>
    moduleObjectiveIds.includes(objective.id),
  );
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/teacher/content/${content.course.id}/lessons/${lesson.id}`, {
      method: 'PATCH',
      body: {
        title: field(form, 'title'),
        objectiveId: field(form, 'objectiveId') || null,
        body: field(form, 'body'),
      },
    });
    onSaved();
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Lesson: {lesson.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} onChange={onEdit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Title"
              name="title"
              defaultValue={lesson.title}
              required
              maxLength={120}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor={objectiveId}>Objective</Label>
              <select
                id={objectiveId}
                name="objectiveId"
                defaultValue={lesson.objectiveId ?? ''}
                className={SELECT_CLASS}
              >
                <option value="">Choose an objective</option>
                {choices.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objectiveLabel(objective)}
                  </option>
                ))}
              </select>
              {choices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Map objectives to this module first.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={bodyId}>Lesson content</Label>
            <Textarea
              id={bodyId}
              name="body"
              defaultValue={lesson.body}
              maxLength={MAX_LESSON_BODY}
              rows={14}
              className="min-h-72 rounded-xl"
              placeholder="Explain the topic, add worked examples, and say which activity checks each objective."
            />
          </div>
          <div>
            <SubmitButton busy={busy}>Save draft</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface LessonStatusProps {
  readonly courseId: string;
  readonly courseCode: string;
  readonly lesson: Lesson;
  readonly dirty: boolean;
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

function LessonStatus({ courseId, courseCode, lesson, dirty, onChanged }: LessonStatusProps) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const publishing = lesson.status === 'draft';

  const toggle = () => {
    if (busy) return;
    if (publishing && dirty) {
      onChanged('Save your changes before publishing.', 'error');
      return;
    }
    setBusy(true);
    auth
      .request(
        `/teacher/content/${courseId}/lessons/${lesson.id}/${publishing ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      )
      .then(
        () => onChanged(publishing ? 'Lesson published.' : 'Lesson is a draft again.'),
        (caught: unknown) => onChanged(errorMessage(caught), 'error'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card className="card-interactive">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-2">
          Status: <StatusBadge status={lesson.status} /> · Audience: enrolled {courseCode} students
        </p>
        <Button
          type="button"
          variant={publishing ? 'default' : 'outline'}
          aria-disabled={busy}
          onClick={toggle}
        >
          {publishing ? 'Publish lesson' : 'Unpublish'}
        </Button>
      </CardContent>
    </Card>
  );
}
