import type { CourseRecord, Program } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  field,
  FormMessage,
  SubmitButton,
  useFocusOnMount,
  useFormAction,
} from '../../../components/form';
import { countOf, termName } from '../../../components/format';
import { SeatsBar } from '../../sections/shared';
import { nextNotice, type Notice } from '../../teacher/content/shared';
import { CourseFields } from './CourseFields';
import { ArchiveDialog } from './CoursesTab';

/** A06 Course offering and curriculum record: the course, where it is taught and by whom. */
export function CourseRecordPage({ courseId }: { courseId: string }) {
  const result = useApiData<CourseRecord>(`/admin/courses/${courseId}/record`);
  const programs = useApiData<Program[]>('/admin/programs');
  const [notice, setNotice] = useState<Notice | null>(null);

  if (result.status === 'loading') return <p role="status">Loading course…</p>;
  if (result.status === 'error') {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-3">
        <p className="text-sm">
          <Link to="/admin/courses" className="link">
            Course Management
          </Link>
        </p>
        <h1 id="page-title" className="text-2xl font-bold">
          Course record
        </h1>
        <FormMessage tone="error">{result.message}</FormMessage>
      </section>
    );
  }
  const { course, offerings, content, resources } = result.data;
  const current = offerings.find((offering) => offering.term.current);

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') result.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/admin/courses" className="link">
          Course Management
        </Link>
      </p>
      <PageHeading />
      <p className="mt-1 text-sm text-muted-foreground">
        {course.code} – {course.title}
      </p>

      {/* FormMessage takes focus, so focus does not fall to the page when the form remounts
          after a save or the archive button turns into restore. */}
      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {result.refreshError && (
        <div className="mt-4">
          <FormMessage tone="error">Could not reload the course: {result.refreshError}</FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Details and configuration</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course.archived ? (
              <p className="text-sm text-muted-foreground">
                Archived courses cannot be edited. Restore it to make changes.
              </p>
            ) : programs.status === 'error' ? (
              <FormMessage tone="error">{programs.message}</FormMessage>
            ) : programs.status === 'loading' ? (
              <p role="status" className="text-sm">
                Loading programs…
              </p>
            ) : (
              <DetailsForm
                // Remounts with the saved values once they arrive.
                key={[
                  course.code,
                  course.title,
                  course.units,
                  course.description,
                  course.programId,
                ].join('\n')}
                record={result.data}
                programs={programs.data}
                onSaved={() => announce('Changes saved.')}
              />
            )}
          </CardContent>
        </Card>

        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Context / status</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              Status:{' '}
              {course.archived ? (
                <Badge variant="secondary" className="rounded-full">
                  Archived
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="rounded-full border-green-200 bg-green-50 text-green-800"
                >
                  Active
                </Badge>
              )}
              <ArchiveDialog
                course={course}
                currentSections={current?.sections.length ?? 0}
                onDone={(text) => announce(text)}
                onError={(text) => announce(text, 'error')}
              />
            </div>
            <p>
              Program: {course.programCode ?? 'General education (all programs)'} ·{' '}
              {countOf(course.units, 'unit')}
            </p>
            <div>
              <h3 className="font-medium">Ownership and course permissions</h3>
              <p className="text-muted-foreground">
                Teachers of its sections this term edit its content; every section follows the same
                outline.
              </p>
            </div>
            <div>
              <h3 className="font-medium">Content</h3>
              <p>
                {countOf(content.objectives, 'objective')} · {content.publishedModules} of{' '}
                {countOf(content.modules, 'module')} published · {content.publishedLessons} of{' '}
                {countOf(content.lessons, 'lesson')} published
              </p>
            </div>
            <div>
              <h3 className="font-medium">Resources</h3>
              <p>
                {resources.approved} approved · {resources.pending} waiting for review ·{' '}
                {resources.total} in all
              </p>
              <Link to="/admin/courses/resources" className="link">
                Resource library
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Course offerings</h2>
        <Link to="/admin/sections" className="link text-sm">
          Section Management
        </Link>
      </div>
      {offerings.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No sections yet. Add one under Section Management.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-6">
          {offerings.map((offering) => (
            <OfferingTable key={offering.term.id} offering={offering} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The h1, which takes focus when the record first shows (it is not there while loading), so
 * arriving from the course list lands keyboard and screen-reader users on it.
 */
function PageHeading() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <h1
      ref={heading}
      id="page-title"
      tabIndex={-1}
      className="mt-2 text-2xl font-bold outline-none"
    >
      Course offering and curriculum record
    </h1>
  );
}

interface DetailsFormProps {
  readonly record: CourseRecord;
  readonly programs: readonly Program[];
  readonly onSaved: () => void;
}

function DetailsForm({ record, programs, onSaved }: DetailsFormProps) {
  const auth = useAuth();
  const { course } = record;
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/admin/courses/${course.id}`, {
      method: 'PATCH',
      body: {
        code: field(form, 'code'),
        title: field(form, 'title'),
        units: field(form, 'units'),
        description: field(form, 'description'),
        programId: field(form, 'programId') || null,
      },
    });
    onSaved();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <CourseFields course={course} programs={programs} />
      <div>
        <SubmitButton busy={busy}>Save course</SubmitButton>
      </div>
    </form>
  );
}

function OfferingTable({ offering }: { offering: CourseRecord['offerings'][number] }) {
  const label = `${termName(offering.term)}${offering.term.current ? ' (current)' : ''}`;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableCaption className="caption-top bg-muted/40 px-4 py-2 text-left font-medium text-foreground">
          {label}
        </TableCaption>
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead scope="col" className="px-4">
              Section
            </TableHead>
            <TableHead scope="col">Assigned faculty</TableHead>
            <TableHead scope="col">Seats</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {offering.sections.map((section) => (
            <TableRow key={section.id}>
              <th scope="row" className="px-4 text-left align-middle font-medium">
                <Link
                  to="/admin/sections/$sectionId"
                  params={{ sectionId: section.id }}
                  className="link"
                >
                  {section.name}
                </Link>
              </th>
              <TableCell className="whitespace-normal">
                {section.teachers.length > 0
                  ? section.teachers.map((teacher) => teacher.displayName).join(', ')
                  : 'No teacher yet'}
              </TableCell>
              <TableCell>
                <SeatsBar
                  enrolled={section.enrolled}
                  capacity={section.capacity}
                  label={`Seats taken, ${section.name}`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
