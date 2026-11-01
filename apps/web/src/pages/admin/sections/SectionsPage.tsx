import type { SectionListResponse, Term } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
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
import { field, FormMessage, SELECT_CLASS, TextField } from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { countOf, termName } from '../../../components/format';
import { SeatsBar, teacherNames } from '../../sections/shared';

function listPath(term: string, q: string, page: number): string {
  const params = new URLSearchParams();
  if (term) params.set('term', term);
  if (q) params.set('q', q);
  params.set('page', String(page));
  return `/admin/sections?${params.toString()}`;
}

/** A07 Section Management: the classes of a term, their teachers and how full they are. */
export function SectionsPage() {
  const auth = useAuth();
  const terms = useApiData<Term[]>('/admin/terms');
  // Empty means "the current term"; the answer says which term that was.
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const result = useApiData<SectionListResponse>(listPath(term, q, page));
  const termList = terms.status === 'ready' ? terms.data : [];
  // Until the list answers, show the current term (what an empty filter means).
  const shownTerm =
    result.status === 'ready'
      ? result.data.termId
      : (termList.find((item) => item.current)?.id ?? null);
  const termFilterId = useId();
  const termFieldId = useId();

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setQ(typeof value === 'string' ? value.trim() : '');
    setPage(1);
  };

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        Section Management
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Classes for each term: who teaches them and who is enrolled.
      </p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={termFilterId}>Term</Label>
            <select
              id={termFilterId}
              value={term || shownTerm || ''}
              onChange={(event) => {
                setTerm(event.target.value);
                setPage(1);
              }}
              className={`${SELECT_CLASS} h-10 w-auto`}
            >
              {termList.length === 0 && <option value="">No terms yet</option>}
              {termList.map((item) => (
                <option key={item.id} value={item.id}>
                  {termName(item)}
                  {item.current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          <form role="search" aria-label="Search sections" onSubmit={search} className="flex gap-2">
            <label htmlFor="section-search" className="sr-only">
              Search by course or section
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="section-search"
                name="q"
                type="search"
                placeholder="Search by course or section"
                defaultValue={q}
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <Button type="submit" variant="outline" className="h-10">
              Search
            </Button>
          </form>
        </div>

        <FormDialog
          trigger={
            <>
              <Plus aria-hidden="true" /> Add section
            </>
          }
          disabled={termList.length === 0}
          title="Add a section"
          description="One class of a course in a term, e.g. IS 301 · BSIS 3-A."
          submitLabel="Add section"
          onSubmit={async (form) => {
            const termId = field(form, 'termId');
            await auth.request('/admin/sections', {
              body: {
                courseCode: field(form, 'courseCode'),
                termId,
                name: field(form, 'name'),
                capacity: field(form, 'capacity'),
              },
            });
            // Show the term the section went into, so the new row is in view.
            if (termId === (term || shownTerm)) {
              result.reload();
            } else {
              setTerm(termId);
              setPage(1);
            }
          }}
        >
          <TextField label="Course code" name="courseCode" placeholder="IS 301" required />
          <div className="flex flex-col gap-2">
            <Label htmlFor={termFieldId}>Term</Label>
            <select
              id={termFieldId}
              name="termId"
              defaultValue={term || shownTerm || termList[0]?.id}
              className={SELECT_CLASS}
            >
              {termList.map((item) => (
                <option key={item.id} value={item.id}>
                  {termName(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <TextField label="Section name" name="name" placeholder="BSIS 3-A" required />
            <TextField
              label="Capacity"
              name="capacity"
              type="number"
              min={1}
              max={200}
              defaultValue={40}
              required
            />
          </div>
        </FormDialog>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <p role="status" className="sr-only">
          {result.status === 'ready' ? countOf(result.data.total, 'section') : ''}
        </p>
        {result.status === 'loading' && <p>Loading sections…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' && !result.data.termId && (
          <p className="text-sm text-muted-foreground">
            No current term. Add one under Course Management → Terms and make it current.
          </p>
        )}
        {result.status === 'ready' && result.data.termId && result.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q ? 'No sections match.' : 'No sections in this term yet. Add the first one.'}
          </p>
        )}
        {result.status === 'ready' && result.data.items.length > 0 && (
          // Older rows stay visible while a new term, search or page loads; dimmed meanwhile.
          <div
            aria-busy={result.refreshing}
            className={`flex flex-col gap-3 transition-opacity ${result.refreshing ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableCaption className="sr-only">Sections</TableCaption>
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    <TableHead scope="col" className="px-4">
                      Course
                    </TableHead>
                    <TableHead scope="col">Section</TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">
                      Teachers
                    </TableHead>
                    <TableHead scope="col">Seats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="animate-fade">
                  {result.data.items.map((section) => (
                    <TableRow key={section.id} className="transition-colors hover:bg-accent/60">
                      <TableCell className="px-4 whitespace-normal">
                        <div className="font-semibold">{section.course.code}</div>
                        <div className="text-xs text-muted-foreground">{section.course.title}</div>
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/admin/sections/$sectionId"
                          params={{ sectionId: section.id }}
                          className="link"
                          aria-label={`${section.course.code} ${section.name}`}
                        >
                          {section.name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">
                        {teacherNames(section)}
                      </TableCell>
                      <TableCell>
                        <SeatsBar
                          enrolled={section.enrolled}
                          capacity={section.capacity}
                          label={`Seats taken, ${section.course.code} ${section.name}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              <span>
                Page {result.data.page} of{' '}
                {Math.max(1, Math.ceil(result.data.total / result.data.pageSize))} ·{' '}
                {countOf(result.data.total, 'section')}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={result.data.page <= 1}
                  onClick={() => setPage(result.data.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={result.data.page * result.data.pageSize >= result.data.total}
                  onClick={() => setPage(result.data.page + 1)}
                >
                  Next
                </Button>
              </span>
            </nav>
          </div>
        )}
      </div>
    </section>
  );
}
