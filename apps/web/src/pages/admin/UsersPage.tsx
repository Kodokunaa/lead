import {
  ROLE_LABELS,
  type AccountStatus,
  type UserListResponse,
  type UserSummary,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import { useApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { formatDateTime } from '../../components/format';
import { StatusBadge } from './StatusBadge';

type StatusFilter = AccountStatus | 'all';

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All accounts' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'rejected', label: 'Rejected' },
];

function listPath(status: StatusFilter, q: string, page: number): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (q) params.set('q', q);
  params.set('page', String(page));
  return `/admin/users?${params.toString()}`;
}

/** A02 user management, including the approval queue (A16) as the "Waiting" filter. */
export function UsersPage() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const result = useApiData<UserListResponse>(listPath(status, q, page));

  const choose = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setQ(typeof value === 'string' ? value.trim() : '');
    setPage(1);
  };

  const awaiting = result.status === 'ready' ? result.data.awaitingApproval : null;

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        User Management
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Approve registrations, and change roles or access. Every change needs a reason and is
        recorded in the audit log.
      </p>

      <div
        className="mt-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by status"
      >
        {FILTERS.map((filter) => {
          const pressed = status === filter.value;
          const showCount = filter.value === 'pending' && awaiting !== null && awaiting > 0;
          return (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              onClick={() => choose(filter.value)}
              className={cn('rounded-full', showCount && !pressed && 'animate-glow')}
            >
              {filter.label}
              {showCount && (
                <>
                  {' '}
                  <span className="font-bold">({awaiting})</span>
                </>
              )}
            </Button>
          );
        })}
      </div>

      <form
        role="search"
        aria-label="Accounts"
        onSubmit={search}
        className="mt-4 flex max-w-md gap-2"
      >
        <label htmlFor="user-search" className="sr-only">
          Search by name or email
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="user-search"
            name="q"
            type="search"
            placeholder="Search by name or email"
            defaultValue={q}
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <Button type="submit" variant="outline" className="h-10">
          Search
        </Button>
      </form>

      <div className="mt-4">
        {result.status === 'loading' && <p role="status">Loading accounts…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' && (
          <UserTable
            response={result.data}
            onPage={setPage}
            emptyText={
              status === 'pending' ? 'Nobody is waiting for approval.' : 'No accounts match.'
            }
          />
        )}
      </div>
    </section>
  );
}

interface UserTableProps {
  readonly response: UserListResponse;
  readonly onPage: (page: number) => void;
  readonly emptyText: string;
}

function UserTable({ response, onPage, emptyText }: UserTableProps) {
  if (response.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  const lastPage = Math.max(1, Math.ceil(response.total / response.pageSize));

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableCaption className="sr-only">Accounts</TableCaption>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Name
              </TableHead>
              <TableHead scope="col">Role</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">
                Requested
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="animate-fade">
            {response.items.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </TableBody>
        </Table>
      </Card>
      <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
        <span aria-live="polite">
          Page {response.page} of {lastPage} · {response.total} accounts
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

function UserRow({ user }: { user: UserSummary }) {
  const waiting = user.status === 'pending' && user.emailVerified;
  return (
    <TableRow className="transition-colors hover:bg-accent/60">
      <TableCell className="px-4 whitespace-normal">
        <Link to="/admin/users/$userId" params={{ userId: user.id }} className="link">
          {user.displayName}
        </Link>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </TableCell>
      <TableCell>{ROLE_LABELS[user.role]}</TableCell>
      <TableCell className="whitespace-normal">
        <StatusBadge status={user.status} />
        {user.status === 'pending' && (
          <div className="mt-1 text-xs text-muted-foreground">
            {waiting ? 'Email confirmed, ready to approve' : 'Email not confirmed yet'}
          </div>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">{formatDateTime(user.createdAt)}</TableCell>
    </TableRow>
  );
}
