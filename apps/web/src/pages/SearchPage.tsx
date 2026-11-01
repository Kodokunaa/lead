import {
  SEARCH_MIN_LENGTH,
  SEARCH_TYPE_LABELS,
  type SearchResponse,
  type SearchResult,
} from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useId, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiData } from '../auth/use-api';
import { FormMessage } from '../components/form';
import { countOf } from '../components/format';

/** H09 Permission-scoped search. The query lives in the address (?q=…), so results can be shared. */
export function SearchPage({ q }: { q: string }) {
  const navigate = useNavigate();
  const inputId = useId();
  const ready = q.trim().length >= SEARCH_MIN_LENGTH;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    void navigate({ to: '/search', search: { q: typeof value === 'string' ? value.trim() : '' } });
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <h1 id="page-title" className="text-2xl font-bold">
        Permission-scoped search
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Finds only what you are allowed to open.</p>

      <form role="search" onSubmit={submit} className="mt-6 flex max-w-xl gap-2">
        <label htmlFor={inputId} className="sr-only">
          Search records
        </label>
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            // Remounts when the address changes, e.g. after searching from the top bar.
            key={q}
            id={inputId}
            name="q"
            type="search"
            defaultValue={q}
            minLength={SEARCH_MIN_LENGTH}
            maxLength={100}
            placeholder="Search records…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <Button type="submit" className="h-10">
          Search
        </Button>
      </form>

      <div className="mt-6">
        {ready ? (
          <Results q={q.trim()} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Type at least {SEARCH_MIN_LENGTH} characters: a course, lesson, resource or name.
          </p>
        )}
      </div>
    </section>
  );
}

function Results({ q }: { q: string }) {
  const result = useApiData<SearchResponse>(`/search?q=${encodeURIComponent(q)}`);

  if (result.status === 'loading') return <p role="status">Searching…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const { results, truncated } = result.data;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {results.length === 0
          ? `Nothing you can open matches “${q}”.`
          : `${countOf(results.length, 'result')} for “${q}”.`}
        {truncated && ' Showing the first matches of each kind; add words to narrow it down.'}
      </p>
      {results.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableCaption className="sr-only">Search results</TableCaption>
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead scope="col" className="px-4">
                  Result
                </TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  Context
                </TableHead>
                <TableHead scope="col">Access</TableHead>
                <TableHead scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="animate-fade">
              {results.map((item) => (
                <TableRow key={`${item.type}:${item.id}`}>
                  <th
                    scope="row"
                    className="px-4 text-left align-middle font-medium whitespace-normal"
                  >
                    {item.title}
                    <div className="text-xs font-normal text-muted-foreground md:hidden">
                      {item.context}
                    </div>
                  </th>
                  <TableCell>{SEARCH_TYPE_LABELS[item.type]}</TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell">
                    {item.context}
                  </TableCell>
                  <TableCell className="capitalize">{item.access}</TableCell>
                  <TableCell className="text-right">
                    <ResultLink item={item} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** "Open" for a result, pointing at the screen the API named. */
function ResultLink({ item }: { item: SearchResult }) {
  const label = `Open ${item.title}`;
  const className = 'link text-sm';
  const { target } = item;
  switch (target.screen) {
    case 'S03':
      return (
        <Link
          to="/student/courses/$sectionId"
          params={{ sectionId: target.sectionId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'S05':
      return (
        <Link
          to="/student/courses/$sectionId/lessons/$lessonId"
          params={{ sectionId: target.sectionId, lessonId: target.lessonId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'S06':
      return (
        <Link
          to="/student/courses/$sectionId/resources/$resourceId"
          params={{ sectionId: target.sectionId, resourceId: target.resourceId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'T03':
      return (
        <Link
          to="/teacher/classes/$sectionId"
          params={{ sectionId: target.sectionId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'T05':
      return (
        <Link
          to="/teacher/content/$courseId/modules/$moduleId"
          params={{ courseId: target.courseId, moduleId: target.moduleId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'T06':
      return (
        <Link
          to="/teacher/content/$courseId/lessons/$lessonId"
          params={{ courseId: target.courseId, lessonId: target.lessonId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'T07':
      return (
        <Link
          to="/teacher/content/$courseId/resources"
          params={{ courseId: target.courseId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'A03':
      return (
        <Link
          to="/admin/users/$userId"
          params={{ userId: target.userId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'A05':
      return (
        <Link to="/admin/courses" className={className} aria-label={label}>
          Open
        </Link>
      );
    case 'A07':
      return (
        <Link
          to="/admin/sections/$sectionId"
          params={{ sectionId: target.sectionId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
    case 'A11':
      return (
        <Link
          to="/admin/courses/resources/$resourceId"
          params={{ resourceId: target.resourceId }}
          className={className}
          aria-label={label}
        >
          Open
        </Link>
      );
  }
}
