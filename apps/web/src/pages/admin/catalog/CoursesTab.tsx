import type { Course, CourseListResponse, Program } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { countOf } from '../../../components/format';
import { FormDialog } from '../../../components/FormDialog';
import { CourseFields } from './CourseFields';

function listPath(q: string, program: string, archived: boolean, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (program) params.set('program', program);
  if (archived) params.set('archived', 'true');
  params.set('page', String(page));
  return `/admin/courses?${params.toString()}`;
}

/** The courses table with search, program filter, and add/edit/archive dialogs. */
export function CoursesTab() {
  const programs = useApiData<Program[]>('/admin/programs');
  const [q, setQ] = useState('');
  const [program, setProgram] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const result = useApiData<CourseListResponse>(listPath(q, program, archived, page));
  const programList = programs.status === 'ready' ? programs.data : [];
  // Without the program list, an edit form would show the wrong program and save it.
  const programsReady = programs.status === 'ready';
  const filterId = useId();
  // Announced and focused after archive or restore, so focus does not fall to the page when the
  // row it was on disappears. The counter re-mounts the message for repeated actions.
  const [notice, setNotice] = useState<{
    text: string;
    key: number;
    tone: 'success' | 'error';
  } | null>(null);
  const announce = (text: string, tone: 'success' | 'error' = 'success') =>
    setNotice((previous) => ({ text, tone, key: (previous?.key ?? 0) + 1 }));

  // After an archive empties the last page, step back to a page that has courses.
  const emptyLaterPage =
    result.status === 'ready' && result.data.items.length === 0 && result.data.page > 1;
  useEffect(() => {
    if (emptyLaterPage) setPage((current) => Math.max(1, current - 1));
  }, [emptyLaterPage]);

  const filtered = q !== '' || program !== '';

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setQ(typeof value === 'string' ? value.trim() : '');
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form role="search" aria-label="Search courses" onSubmit={search} className="flex gap-2">
          <label htmlFor="course-search" className="sr-only">
            Search by code or title
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="course-search"
              name="q"
              type="search"
              placeholder="Search by code or title"
              defaultValue={q}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10">
            Search
          </Button>
        </form>
        <CourseDialog programs={programList} disabled={!programsReady} onSaved={result.reload} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor={filterId}>Program</Label>
          <select
            id={filterId}
            value={program}
            onChange={(event) => {
              setProgram(event.target.value);
              setPage(1);
            }}
            className={`${SELECT_CLASS} h-10 w-auto`}
          >
            <option value="">All programs</option>
            <option value="general">General education</option>
            {programList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
            className="size-4 accent-[var(--lead-brand)]"
          />
          Show archived courses
        </label>
      </div>

      {notice && (
        <FormMessage key={notice.key} tone={notice.tone}>
          {notice.text}
        </FormMessage>
      )}
      <p role="status" className="sr-only">
        {result.status === 'ready' ? countOf(result.data.total, 'course') : ''}
      </p>
      {result.status === 'loading' && <p>Loading courses…</p>}
      {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
      {result.status === 'ready' && (
        <CourseTable
          response={result.data}
          programs={programList}
          programsReady={programsReady}
          emptyText={
            filtered
              ? 'No courses match these filters.'
              : archived
                ? 'No archived courses.'
                : 'No courses yet. Add the first one.'
          }
          onChanged={(text) => {
            if (text) announce(text);
            result.reload();
          }}
          onError={(text) => announce(text, 'error')}
          onPage={setPage}
        />
      )}
    </div>
  );
}

interface CourseTableProps {
  readonly response: CourseListResponse;
  readonly programs: Program[];
  readonly programsReady: boolean;
  readonly emptyText: string;
  /** After a change; `text` is announced when given. */
  readonly onChanged: (text?: string) => void;
  readonly onError: (text: string) => void;
  readonly onPage: (page: number) => void;
}

function CourseTable({
  response,
  programs,
  programsReady,
  emptyText,
  onChanged,
  onError,
  onPage,
}: CourseTableProps) {
  if (response.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  const lastPage = Math.max(1, Math.ceil(response.total / response.pageSize));

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableCaption className="sr-only">Courses</TableCaption>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Code
              </TableHead>
              <TableHead scope="col">Title</TableHead>
              <TableHead scope="col">Program</TableHead>
              <TableHead scope="col" className="text-center">
                Units
              </TableHead>
              <TableHead scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="animate-fade">
            {response.items.map((course) => (
              <TableRow key={course.id} className="transition-colors hover:bg-accent/60">
                <TableCell className="px-4 font-semibold">
                  <Link
                    to="/admin/courses/$courseId"
                    params={{ courseId: course.id }}
                    className="link"
                    aria-label={`${course.code} record`}
                  >
                    {course.code}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {course.title}
                  {course.archived && (
                    <Badge variant="secondary" className="ml-2 rounded-full">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{course.programCode ?? 'General education'}</TableCell>
                <TableCell className="text-center">{course.units}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex gap-2">
                    {!course.archived && (
                      <CourseDialog
                        course={course}
                        programs={programs}
                        disabled={!programsReady}
                        onSaved={() => onChanged()}
                      />
                    )}
                    <ArchiveDialog course={course} onDone={onChanged} onError={onError} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <nav aria-label="Pages" className="flex items-center justify-between text-sm">
        <span>
          Page {response.page} of {lastPage} · {countOf(response.total, 'course')}
        </span>
        <span className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={response.page <= 1}
            onClick={() => onPage(response.page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={response.page >= lastPage}
            onClick={() => onPage(response.page + 1)}
          >
            Next
          </Button>
        </span>
      </nav>
    </>
  );
}

interface CourseDialogProps {
  /** Present when editing; absent when adding. */
  readonly course?: Course;
  readonly programs: Program[];
  readonly disabled: boolean;
  readonly onSaved: () => void;
}

function CourseDialog({ course, programs, disabled, onSaved }: CourseDialogProps) {
  const auth = useAuth();

  const save = async (form: FormData) => {
    const body = {
      code: field(form, 'code'),
      title: field(form, 'title'),
      units: field(form, 'units'),
      description: field(form, 'description'),
      programId: field(form, 'programId') || null,
    };
    if (course) {
      await auth.request(`/admin/courses/${course.id}`, { method: 'PATCH', body });
    } else {
      await auth.request('/admin/courses', { body });
    }
    onSaved();
  };

  return (
    <FormDialog
      trigger={
        course ? (
          'Edit'
        ) : (
          <>
            <Plus aria-hidden="true" /> Add course
          </>
        )
      }
      triggerVariant={course ? 'outline' : 'default'}
      triggerLabel={course ? `Edit ${course.code}` : undefined}
      disabled={disabled}
      title={course ? `Edit ${course.code}` : 'Add a course'}
      description="Course codes are saved in capitals, e.g. IS 301."
      submitLabel={course ? 'Save changes' : 'Add course'}
      onSubmit={save}
    >
      <CourseFields course={course} programs={programs} />
    </FormDialog>
  );
}

interface ArchiveDialogProps {
  readonly course: Course;
  /** Sections of this course in the current term, when known: archiving does not end them. */
  readonly currentSections?: number;
  readonly onDone: (text: string) => void;
  readonly onError: (text: string) => void;
}

export function ArchiveDialog({ course, currentSections, onDone, onError }: ArchiveDialogProps) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  if (course.archived) {
    const restore = () => {
      if (busy) return;
      setBusy(true);
      auth
        .request(`/admin/courses/${course.id}/restore`, { method: 'POST' })
        .then(() => onDone(`${course.code} restored.`))
        .catch((caught: unknown) => onError(errorMessage(caught)))
        .finally(() => setBusy(false));
    };
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={restore}
        aria-disabled={busy}
        aria-label={`Restore ${course.code}`}
      >
        Restore
      </Button>
    );
  }

  return (
    <FormDialog
      trigger="Archive"
      triggerVariant="ghost"
      triggerLabel={`Archive ${course.code}`}
      title={`Archive ${course.code}`}
      description={
        currentSections
          ? `${countOf(currentSections, 'section')} of ${course.code} this term will keep running; archiving only stops new sections. Existing records stay.`
          : 'Archived courses get no new sections. Existing classes and records stay.'
      }
      submitLabel="Archive course"
      onSubmit={async (form) => {
        await auth.request(`/admin/courses/${course.id}/archive`, {
          body: { reason: field(form, 'reason') },
        });
      }}
      // The row disappears with the reload, so the announcement takes focus instead.
      afterSave={() => onDone(`${course.code} archived.`)}
    >
      <TextField
        label="Reason"
        name="reason"
        hint="Recorded in the audit log."
        required
        minLength={3}
      />
    </FormDialog>
  );
}
