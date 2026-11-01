import {
  RESOURCE_STATUSES,
  RESOURCE_STATUS_LABELS,
  type ResourceListResponse,
  type ResourceStatus,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
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
import { useApiData } from '../../../auth/use-api';
import { FormMessage, SELECT_CLASS } from '../../../components/form';
import { countOf } from '../../../components/format';
import { RAG_LABELS, ResourceStatusBadge } from '../../resources/shared';

function listPath(q: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  params.set('page', String(page));
  return `/admin/resources?${params.toString()}`;
}

/** A10 Approved reference resource library: every course's resources and where they stand. */
export function ResourceLibraryPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ResourceStatus | ''>('');
  const [page, setPage] = useState(1);
  const result = useApiData<ResourceListResponse>(listPath(q, status, page));
  const statusId = useId();

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setQ(typeof value === 'string' ? value.trim() : '');
    setPage(1);
  };

  return (
    <section aria-labelledby="page-title">
      <p className="text-sm">
        <Link to="/admin/courses" className="link">
          Course Management
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Approved reference resource library
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Teachers&apos; uploads for every course. Only approved versions reach students and, later,
        the AI tools.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <form role="search" aria-label="Search resources" onSubmit={search} className="flex gap-2">
          <label htmlFor="resource-search" className="sr-only">
            Search by title or course code
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="resource-search"
              name="q"
              type="search"
              placeholder="Search by title or course code"
              defaultValue={q}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10">
            Search
          </Button>
        </form>
        <div className="flex flex-col gap-2">
          <Label htmlFor={statusId}>Status</Label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ResourceStatus | '');
              setPage(1);
            }}
            className={`${SELECT_CLASS} h-10 w-auto`}
          >
            <option value="">All</option>
            {RESOURCE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {RESOURCE_STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <p role="status" className="sr-only">
          {result.status === 'ready' ? countOf(result.data.total, 'resource') : ''}
        </p>
        {result.status === 'loading' && <p>Loading resources…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' && result.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q || status ? 'No resources match.' : 'No resources have been submitted yet.'}
          </p>
        )}
        {result.status === 'ready' && result.data.items.length > 0 && (
          <div
            aria-busy={result.refreshing}
            className={`flex flex-col gap-3 transition-opacity ${result.refreshing ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableCaption className="sr-only">Resources</TableCaption>
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    <TableHead scope="col" className="px-4">
                      Resource
                    </TableHead>
                    <TableHead scope="col">Course scope</TableHead>
                    <TableHead scope="col">Version</TableHead>
                    <TableHead scope="col">Approval</TableHead>
                    <TableHead scope="col">RAG status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="animate-fade">
                  {result.data.items.map((resource) => (
                    <TableRow key={resource.id}>
                      <th scope="row" className="px-4 text-left align-middle whitespace-normal">
                        <Link
                          to="/admin/courses/resources/$resourceId"
                          params={{ resourceId: resource.id }}
                          className="link font-medium"
                        >
                          {resource.title}
                        </Link>
                      </th>
                      <TableCell>{resource.course.code}</TableCell>
                      <TableCell>v{resource.latest.number}</TableCell>
                      <TableCell>
                        <ResourceStatusBadge status={resource.latest.status} />
                      </TableCell>
                      <TableCell>{RAG_LABELS[resource.ragStatus]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              <span>
                Page {result.data.page} of{' '}
                {Math.max(1, Math.ceil(result.data.total / result.data.pageSize))}
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
