import type { CourseContent, Lesson, TeacherCourse } from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, BookOpen, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import {
  errorMessage,
  field,
  FormMessage,
  SELECT_CLASS,
  TextField,
} from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { courseHeading, nextNotice, objectiveCodes, StatusBadge, type Notice } from './shared';

/** T04 entry: the courses this teacher can edit this term. */
export function ContentHomePage() {
  const result = useApiData<TeacherCourse[]>('/teacher/content');

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        Course Content
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Modules, lessons and learning objectives for the courses you teach this term. Every section
        of a course follows the same outline.
      </p>
      <div className="mt-6">
        {result.status === 'loading' && <p role="status">Loading courses…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' &&
          (result.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no classes this term, so there is no course content to edit.
            </p>
          ) : (
            <ul aria-label="Courses" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.data.map((course) => (
                <li key={course.id} className="flex">
                  <Card className="card-interactive flex w-full gap-0 py-0">
                    <Link
                      to="/teacher/content/$courseId"
                      params={{ courseId: course.id }}
                      className="flex flex-1 flex-col gap-1 rounded-[inherit] p-5 outline-offset-4"
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-brand-strong">
                        <BookOpen aria-hidden="true" className="size-4" /> {course.code}
                      </span>
                      <span className="font-semibold">{course.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {course.sections.join(', ')}
                      </span>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}

/** T04 Course outline and content: objectives, modules in order, and their lessons. */
export function CourseOutlinePage({ courseId }: { courseId: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const result = useApiData<CourseContent>(`/teacher/content/${courseId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const lessonModuleId = useId();

  if (result.status === 'loading') return <p role="status">Loading course content…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const content = result.data;
  const base = `/teacher/content/${courseId}`;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') result.reload();
  };

  const move = (moduleId: string, title: string, direction: 'up' | 'down') => {
    if (moving) return;
    setMoving(moduleId);
    auth
      .request(`${base}/modules/${moduleId}/move`, { body: { direction } })
      .then(
        () => announce(`${title} moved ${direction}.`),
        (caught: unknown) => {
          // The order may have changed elsewhere; show the current one before the next move.
          announce(errorMessage(caught), 'error');
          result.reload();
        },
      )
      .finally(() => setMoving(null));
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/teacher/content" className="link">
          Course Content
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Course outline and content
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Current term · {courseHeading(content)}</p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}

      <Card className="mt-6 animate-rise">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            <h2 className="text-base font-semibold">Learning objectives</h2>
          </CardTitle>
          <FormDialog
            trigger={
              <>
                <Plus aria-hidden="true" /> Add objective
              </>
            }
            triggerVariant="outline"
            title="Add a learning objective"
            description="What students will be able to do, e.g. “Normalize a relation to 3NF”. Objectives are numbered O1, O2, … and reused in assessments and mastery."
            submitLabel="Add objective"
            onSubmit={async (form) => {
              await auth.request(`${base}/objectives`, {
                body: { description: field(form, 'description') },
              });
            }}
            afterSave={() => announce('Objective added.')}
          >
            <TextField
              label="Objective"
              name="description"
              required
              minLength={5}
              maxLength={300}
            />
          </FormDialog>
        </CardHeader>
        <CardContent>
          {content.objectives.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No objectives yet. Add them first: modules and lessons are mapped to them.
            </p>
          ) : (
            <ul aria-label="Learning objectives" className="divide-y divide-border">
              {content.objectives.map((objective) => (
                <li key={objective.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">
                    <span className="font-semibold">{objective.code}</span> {objective.description}
                  </span>
                  <FormDialog
                    trigger="Edit"
                    triggerVariant="ghost"
                    triggerLabel={`Edit ${objective.code}`}
                    title={`Edit ${objective.code}`}
                    description="Modules, lessons and assessments that use this objective keep using it."
                    submitLabel="Save"
                    onSubmit={async (form) => {
                      await auth.request(`${base}/objectives/${objective.id}`, {
                        method: 'PATCH',
                        body: { description: field(form, 'description') },
                      });
                    }}
                    afterSave={() => announce(`${objective.code} updated.`)}
                  >
                    <TextField
                      label="Objective"
                      name="description"
                      defaultValue={objective.description}
                      required
                      minLength={5}
                      maxLength={300}
                    />
                  </FormDialog>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <h2 className="mt-8 text-lg font-semibold">Outline</h2>
      <div className="mt-3">
        {content.modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modules yet. Add the first one.</p>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableCaption className="sr-only">Modules and lessons</TableCaption>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    Order / module
                  </TableHead>
                  <TableHead scope="col">Mapped objective</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="animate-fade">
                {content.modules.flatMap((module, index) => [
                  <TableRow key={module.id} className="bg-accent/30">
                    <th
                      scope="row"
                      className="px-4 text-left align-middle font-semibold whitespace-normal"
                    >
                      <span className="sr-only">Module </span>
                      {module.position} / {module.title}
                    </th>
                    <TableCell>{objectiveCodes(content, module.objectiveIds)}</TableCell>
                    <TableCell>
                      <StatusBadge status={module.status} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        aria-disabled={moving !== null}
                        aria-label={`Move ${module.title} up`}
                        onClick={() => move(module.id, module.title, 'up')}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === content.modules.length - 1}
                        aria-disabled={moving !== null}
                        aria-label={`Move ${module.title} down`}
                        onClick={() => move(module.id, module.title, 'down')}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Link
                        to="/teacher/content/$courseId/modules/$moduleId"
                        params={{ courseId, moduleId: module.id }}
                        className="link ml-2 text-sm"
                        aria-label={`Edit module ${module.title}`}
                      >
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>,
                  ...module.lessons.map((lesson) => (
                    <TableRow key={lesson.id}>
                      <th
                        scope="row"
                        className="px-4 text-left align-middle pl-8 font-normal whitespace-normal"
                      >
                        Lesson: {lesson.title}
                      </th>
                      <TableCell>
                        {lesson.objectiveId ? objectiveCodes(content, [lesson.objectiveId]) : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={lesson.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/teacher/content/$courseId/lessons/$lessonId"
                          params={{ courseId, lessonId: lesson.id }}
                          className="link text-sm"
                          aria-label={`Edit lesson ${lesson.title}`}
                        >
                          Edit
                        </Link>
                      </TableCell>
                    </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Publishing needs mapped learning objectives, and lessons need their content written.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <FormDialog
          trigger={
            <>
              <Plus aria-hidden="true" /> Add module
            </>
          }
          title="Add a module"
          description="It goes to the end of the outline as a draft. You set its objectives next."
          submitLabel="Add module"
          onSubmit={async (form) => {
            const updated = await auth.request<CourseContent>(`${base}/modules`, {
              body: { title: field(form, 'title') },
            });
            // The new module is the one that was not there before (another teacher may have
            // added one at the same moment, so "the last one" is not enough).
            const known = new Set(content.modules.map((module) => module.id));
            const created = updated.modules.filter((module) => !known.has(module.id));
            const mine = created.find((module) => module.title === field(form, 'title').trim());
            if (!mine) {
              announce('Module added. Open it from the outline below.');
              return;
            }
            await navigate({
              to: '/teacher/content/$courseId/modules/$moduleId',
              params: { courseId, moduleId: mine.id },
            });
          }}
        >
          <TextField label="Module title" name="title" required maxLength={120} />
        </FormDialog>
        <FormDialog
          trigger={
            <>
              <Plus aria-hidden="true" /> Add lesson
            </>
          }
          triggerVariant="outline"
          disabled={content.modules.length === 0}
          title="Add a lesson"
          description="It starts as a draft at the end of the module."
          submitLabel="Add lesson"
          onSubmit={async (form) => {
            const lesson = await auth.request<Lesson>(
              `${base}/modules/${field(form, 'moduleId')}/lessons`,
              { body: { title: field(form, 'title') } },
            );
            await navigate({
              to: '/teacher/content/$courseId/lessons/$lessonId',
              params: { courseId, lessonId: lesson.id },
            });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={lessonModuleId}>Module</Label>
            <select id={lessonModuleId} name="moduleId" className={SELECT_CLASS}>
              {content.modules.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.position} / {module.title}
                </option>
              ))}
            </select>
          </div>
          <TextField label="Lesson title" name="title" required maxLength={120} />
        </FormDialog>
        <Link
          to="/teacher/content/$courseId/resources"
          params={{ courseId }}
          className="link self-center text-sm"
        >
          Resources
        </Link>
      </div>
    </section>
  );
}
