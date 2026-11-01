import type { ClassCalendar, CourseContent, SectionDetails } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { CalendarDays, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiData, type ApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { countOf, termName, todayInManila } from '../../components/format';
import { RosterTable, SeatsBar, teacherNames } from '../sections/shared';
import { Upcoming } from '../calendar/Upcoming';
import { objectiveCodes, StatusBadge } from './content/shared';

/** T03 Class overview: the class's details, its course outline, what is coming up, its students. */
export function ClassOverviewPage({ sectionId }: { sectionId: string }) {
  const result = useApiData<SectionDetails>(`/teacher/classes/${sectionId}`);
  // Started alongside the class itself rather than after it, since it needs only the section.
  const calendar = useApiData<ClassCalendar>(`/teacher/classes/${sectionId}/calendar`);

  if (result.status === 'loading') return <p role="status">Loading class…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const section = result.data;
  const enrolled = section.roster.filter((entry) => entry.status === 'enrolled');

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/teacher/classes" className="link">
          My Classes
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        {section.course.code} · {section.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Class overview · {section.course.title} · {termName(section.term)}
      </p>

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Course details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Section</dt>
              <dd>{section.name}</dd>
              <dt className="text-muted-foreground">Term</dt>
              <dd>
                {termName(section.term)}
                {section.term.current ? ' (current)' : ''}
              </dd>
              <dt className="text-muted-foreground">Instructor</dt>
              <dd>{teacherNames(section)}</dd>
              <dt className="text-muted-foreground">Students</dt>
              <dd>
                <SeatsBar enrolled={section.enrolled} capacity={section.capacity} />
              </dd>
            </dl>
          </CardContent>
        </Card>
        <UpcomingCard result={calendar} />
      </div>

      <div className="mt-4">
        <WorkspaceCard courseId={section.course.id} current={section.term.current} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">
        Class list · {countOf(enrolled.length, 'student')}
      </h2>
      <div className="mt-3">
        <RosterTable roster={enrolled} />
      </div>
    </section>
  );
}

/** Upcoming / class activity: the grading period now under way and the next events. */
function UpcomingCard({ result }: { result: ApiData<ClassCalendar> }) {
  const today = todayInManila();

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CalendarDays aria-hidden="true" className="size-4 text-brand-strong" /> Upcoming /
            class activity
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {result.status === 'loading' && <p role="status">Loading calendar…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' && <Upcoming calendar={result.data} today={today} />}
      </CardContent>
    </Card>
  );
}

/** Class workspace: the course's objectives and modules, as the class follows them. */
function WorkspaceCard({ courseId, current }: { courseId: string; current: boolean }) {
  return (
    <Card className="card-interactive">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Layers aria-hidden="true" className="size-4 text-brand-strong" /> Class workspace
          </h2>
        </CardTitle>
        {current && (
          <Link to="/teacher/content/$courseId" params={{ courseId }} className="link text-sm">
            Course content
          </Link>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {current ? (
          <Workspace courseId={courseId} />
        ) : (
          <p className="text-muted-foreground">
            Course content is shown for this term&apos;s classes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Workspace({ courseId }: { courseId: string }) {
  const result = useApiData<CourseContent>(`/teacher/content/${courseId}`);

  if (result.status === 'loading') return <p role="status">Loading course content…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const content = result.data;

  return (
    <div className="flex flex-col gap-4">
      {content.objectives.length === 0 ? (
        <p className="text-muted-foreground">No learning objectives yet.</p>
      ) : (
        <ul aria-label="Learning objectives" className="flex flex-col gap-1">
          {content.objectives.map((objective) => (
            <li key={objective.id}>
              <span className="font-semibold">{objective.code}</span> {objective.description}
            </li>
          ))}
        </ul>
      )}
      {content.modules.length === 0 ? (
        <p className="text-muted-foreground">No modules yet.</p>
      ) : (
        <ul aria-label="Modules" className="divide-y divide-border">
          {content.modules.map((module) => (
            <li key={module.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                Module {module.position}: {module.title}{' '}
                <span className="text-muted-foreground">
                  · {objectiveCodes(content, module.objectiveIds)} ·{' '}
                  {countOf(module.lessons.length, 'lesson')}
                </span>
              </span>
              <StatusBadge status={module.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
