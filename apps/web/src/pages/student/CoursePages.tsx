import type {
  StudentClassOverview,
  StudentLesson,
  StudentResource,
  StudentResourceView,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { BookOpen, CalendarDays, FileText, Layers } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiData } from '../../auth/use-api';
import { FormMessage, useFocusOnMount } from '../../components/form';
import { termName, todayInManila } from '../../components/format';
import { Upcoming } from '../calendar/Upcoming';
import { formatBytes, OpenVersion } from '../resources/shared';
import { teacherNames } from '../sections/shared';

interface ShellProps {
  readonly back: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The frame of each page: a way back, the h1 and the content. The h1 takes focus when it
 * appears, so moving from lesson to lesson (each a fresh page) lands keyboard and screen-reader
 * users on the new title instead of nowhere.
 */
export function PageShell({
  back,
  title,
  subtitle,
  className = 'max-w-5xl',
  children,
}: ShellProps) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section aria-labelledby="page-title" className={className}>
      <p className="text-sm">{back}</p>
      <h1
        ref={heading}
        id="page-title"
        tabIndex={-1}
        className="mt-2 text-2xl font-bold break-words outline-none"
      >
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  );
}

/** Loading or error, still with a heading and a way back (e.g. "No such class."). */
export function StateShell({
  back,
  title,
  state,
}: {
  back: ReactNode;
  title: string;
  state: { status: 'loading' } | { status: 'error'; message: string };
}) {
  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">{back}</p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        {title}
      </h1>
      <div className="mt-4">
        {state.status === 'loading' ? (
          <p role="status">Loading…</p>
        ) : (
          <FormMessage tone="error">{state.message}</FormMessage>
        )}
      </div>
    </section>
  );
}

function BackToCourses() {
  return (
    <Link to="/student/courses" className="link">
      My Courses
    </Link>
  );
}

function BackToCourse({ sectionId, label }: { sectionId: string; label: string }) {
  return (
    <Link to="/student/courses/$sectionId" params={{ sectionId }} className="link">
      {label}
    </Link>
  );
}

/** S03 Course overview and syllabus: the class's outline, references and what is coming up. */
export function StudentCoursePage({ sectionId }: { sectionId: string }) {
  const result = useApiData<StudentClassOverview>(`/student/classes/${sectionId}`);
  const modulesId = useId();
  const referencesId = useId();

  if (result.status !== 'ready') {
    return <StateShell back={<BackToCourses />} title="Course" state={result} />;
  }
  const { section, objectives, modules, resources, calendar } = result.data;

  return (
    <PageShell
      back={<BackToCourses />}
      title={`${section.course.code} · ${section.course.title}`}
      subtitle={`Course overview · ${section.name} · ${termName(section.term)}`}
    >
      <div className="stagger mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Course details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Section</dt>
              <dd className="min-w-0 break-words">{section.name}</dd>
              <dt className="text-muted-foreground">Term</dt>
              <dd className="min-w-0 break-words">{termName(section.term)}</dd>
              <dt className="text-muted-foreground">Instructor</dt>
              <dd className="min-w-0 break-words">{teacherNames(section)}</dd>
            </dl>
            {objectives.length > 0 && (
              <div>
                <h3 className="font-medium">Objectives</h3>
                <ul aria-label="Learning objectives" className="mt-1 flex flex-col gap-1">
                  {objectives.map((objective) => (
                    <li key={objective.id}>
                      <span className="font-semibold">{objective.code}</span>{' '}
                      {objective.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <CalendarDays aria-hidden="true" className="size-4 text-brand-strong" />
                Upcoming and class activity
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Upcoming calendar={calendar} today={todayInManila()} />
          </CardContent>
        </Card>
      </div>

      <h2 id={modulesId} className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <Layers aria-hidden="true" className="size-5 text-brand-strong" /> Learning modules
      </h2>
      {modules.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Your teacher has not published any modules yet.
        </p>
      ) : (
        <ol aria-labelledby={modulesId} className="stagger mt-3 flex flex-col gap-3">
          {modules.map((module) => (
            <li key={module.id}>
              <Card className="card-interactive gap-2 py-4">
                <CardContent className="flex flex-col gap-2 text-sm">
                  <h3 className="font-semibold break-words">
                    Module {module.position}: {module.title}
                  </h3>
                  {module.description && (
                    <p className="break-words text-muted-foreground">{module.description}</p>
                  )}
                  {(module.requiresPrevious || module.masteryThreshold !== null) && (
                    <p className="text-xs text-muted-foreground">
                      {module.requiresPrevious && 'Finish the previous module first. '}
                      {module.masteryThreshold !== null &&
                        `Mastery means scoring ${module.masteryThreshold}% or more.`}
                    </p>
                  )}
                  {module.lessons.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {module.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <Link
                            to="/student/courses/$sectionId/lessons/$lessonId"
                            params={{ sectionId, lessonId: lesson.id }}
                            className="link inline-flex items-center gap-2"
                          >
                            <BookOpen aria-hidden="true" className="size-4 shrink-0" />
                            {lesson.position}. {lesson.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No lessons yet.</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <h2 id={referencesId} className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <FileText aria-hidden="true" className="size-5 text-brand-strong" /> Syllabus and approved
        references
      </h2>
      <div className="mt-3">
        <ResourceList sectionId={sectionId} resources={resources} labelledBy={referencesId} />
      </div>
    </PageShell>
  );
}

interface ResourceListProps {
  readonly sectionId: string;
  readonly resources: readonly StudentResource[];
  readonly labelledBy: string;
}

function ResourceList({ sectionId, resources, labelledBy }: ResourceListProps) {
  if (resources.length === 0) {
    return <p className="text-sm text-muted-foreground">No approved references yet.</p>;
  }
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col gap-2 text-sm">
      {resources.map((resource) => (
        <li key={resource.id} className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to="/student/courses/$sectionId/resources/$resourceId"
            params={{ sectionId, resourceId: resource.id }}
            className="link font-medium break-words"
          >
            {resource.title}
          </Link>
          <span className="text-muted-foreground">
            {resource.module?.title ?? 'Whole course'}
            {resource.objectives.length > 0 &&
              ` · ${resource.objectives.map((objective) => objective.code).join(', ')}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** S05 Lesson and objective view. The lesson text is shown as text, never as HTML. */
export function StudentLessonPage({
  sectionId,
  lessonId,
}: {
  sectionId: string;
  lessonId: string;
}) {
  const result = useApiData<StudentLesson>(`/student/classes/${sectionId}/lessons/${lessonId}`);
  const sourcesId = useId();

  if (result.status !== 'ready') {
    return (
      <StateShell
        back={<BackToCourse sectionId={sectionId} label="Back to the course" />}
        title="Lesson"
        state={result}
      />
    );
  }
  const lesson = result.data;
  const index = lesson.module.lessons.findIndex((item) => item.id === lesson.id);
  const previous = lesson.module.lessons[index - 1];
  const next = lesson.module.lessons[index + 1];

  return (
    <PageShell
      back={
        <BackToCourse
          sectionId={sectionId}
          label={`${lesson.course.code} · ${lesson.course.title}`}
        />
      }
      title={`Lesson: ${lesson.title}`}
      subtitle={`Module ${lesson.module.position}: ${lesson.module.title}`}
      className="max-w-6xl"
    >
      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[1fr_3fr]">
        {/* The lesson comes first in reading order; on wide screens the outline sits left. */}
        <div className="flex min-w-0 flex-col gap-4 lg:order-2">
          {lesson.objective && (
            <p className="rounded-xl border border-orange-200 bg-accent p-4 text-sm">
              <span className="font-semibold">Learning objective {lesson.objective.code}:</span>{' '}
              {lesson.objective.description}
            </p>
          )}
          <Card className="card-interactive">
            <CardContent>
              <h2 className="sr-only">Lesson content</h2>
              {/* Plain text: React escapes it, and line breaks are kept as written. */}
              <div className="max-w-prose text-sm leading-relaxed break-words whitespace-pre-wrap">
                {lesson.body}
              </div>
            </CardContent>
          </Card>
          <Card className="card-interactive">
            <CardHeader>
              <CardTitle>
                <h2 id={sourcesId} className="text-base font-semibold">
                  Related sources
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResourceList
                sectionId={sectionId}
                resources={lesson.resources}
                labelledBy={sourcesId}
              />
            </CardContent>
          </Card>
          {(previous || next) && (
            <nav aria-label="Lesson navigation" className="flex flex-wrap justify-between gap-3">
              {previous ? (
                <Link
                  to="/student/courses/$sectionId/lessons/$lessonId"
                  params={{ sectionId, lessonId: previous.id }}
                  className="link text-sm font-medium"
                >
                  Previous lesson: {previous.title}
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to="/student/courses/$sectionId/lessons/$lessonId"
                  params={{ sectionId, lessonId: next.id }}
                  className="link text-sm font-medium"
                >
                  Next lesson: {next.title}
                </Link>
              )}
            </nav>
          )}
        </div>

        <Card className="card-interactive self-start lg:order-1">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Module outline</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <nav aria-label="Module outline">
              <ol className="flex flex-col gap-1">
                {lesson.module.lessons.map((item) => (
                  <li key={item.id} className="text-sm break-words">
                    {item.id === lesson.id ? (
                      <span aria-current="page" className="font-semibold text-brand-strong">
                        {item.position}. {item.title}
                      </span>
                    ) : (
                      <Link
                        to="/student/courses/$sectionId/lessons/$lessonId"
                        params={{ sectionId, lessonId: item.id }}
                        className="link"
                      >
                        {item.position}. {item.title}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

/** "ccc.edu.ph" for a link, so learners can see where it leads. */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match?.[1] ?? url;
}

/** S06 Approved learning resource viewer. */
export function StudentResourcePage({
  sectionId,
  resourceId,
}: {
  sectionId: string;
  resourceId: string;
}) {
  const result = useApiData<StudentResourceView>(
    `/student/classes/${sectionId}/resources/${resourceId}`,
  );
  const [error, setError] = useState<string | null>(null);

  if (result.status !== 'ready') {
    return (
      <StateShell
        back={<BackToCourse sectionId={sectionId} label="Back to the course" />}
        title="Resource"
        state={result}
      />
    );
  }
  const resource = result.data;
  const { version } = resource;

  return (
    <PageShell
      back={
        <BackToCourse
          sectionId={sectionId}
          label={`${resource.course.code} · ${resource.course.title}`}
        />
      }
      title={resource.title}
      subtitle={`Approved learning resource · version ${version.number}`}
      className="max-w-4xl"
    >
      {error && (
        <div className="mt-4">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Material</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="break-words">
              {version.kind === 'link' && version.url
                ? `An approved web page on ${hostOf(version.url)}. It opens in a new tab.`
                : `${version.fileName ?? 'File'} · ${formatBytes(version.sizeBytes ?? 0)}`}
            </p>
            <div>
              <OpenVersion
                filePath={`/student/classes/${sectionId}/resources/${resource.id}/file`}
                version={version}
                label={version.kind === 'link' ? 'Open the page' : 'Download'}
                onError={setError}
              />
            </div>
          </CardContent>
        </Card>
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Resource details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Course</dt>
              <dd className="min-w-0 break-words">{resource.course.code}</dd>
              <dt className="text-muted-foreground">Module</dt>
              <dd className="min-w-0 break-words">{resource.module?.title ?? 'Whole course'}</dd>
              <dt className="text-muted-foreground">Objectives</dt>
              <dd>{resource.objectives.map((objective) => objective.code).join(', ') || 'None'}</dd>
              <dt className="text-muted-foreground">Approved</dt>
              <dd>Version {version.number}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Available to enrolled learners.</p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
