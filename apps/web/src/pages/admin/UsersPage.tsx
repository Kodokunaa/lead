import {
  ROLE_LABELS,
  type AccountStatus,
  type UserListResponse,
  type UserSummary,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { formatDateTime } from '../../components/format';

type StatusFilter = AccountStatus | 'all';

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All accounts' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'rejected', label: 'Rejected' },
];

export const STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  pending: 'Pending',
  active: 'Active',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};

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
      <p className="mt-1 text-sm text-muted">
        Approve registrations, and change roles or access. Every change needs a reason and is
        recorded in the audit log.
      </p>

      <div
        className="mt-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by status"
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={status === filter.value}
            onClick={() => choose(filter.value)}
            className="rounded-full border border-border px-3 py-1 text-sm aria-pressed:bg-brand aria-pressed:text-brand-text"
          >
            {filter.label}
            {filter.value === 'pending' && awaiting !== null && awaiting > 0 && (
              <>
                {' '}
                <span className="font-semibold">({awaiting})</span>
              </>
            )}
          </button>
        ))}
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
        <input
          id="user-search"
          name="q"
          type="search"
          placeholder="Search by name or email"
          defaultValue={q}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">
          Search
        </button>
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
  if (response.items.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  const lastPage = Math.max(1, Math.ceil(response.total / response.pageSize));

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Accounts</caption>
          <thead className="border-b border-border text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Role
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                Requested
              </th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
        <span aria-live="polite">
          Page {response.page} of {lastPage} · {response.total} accounts
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            disabled={response.page <= 1}
            onClick={() => onPage(response.page - 1)}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={response.page >= lastPage}
            onClick={() => onPage(response.page + 1)}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </span>
      </nav>
    </>
  );
}

function UserRow({ user }: { user: UserSummary }) {
  const waiting = user.status === 'pending' && user.emailVerified;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <Link
          to="/admin/users/$userId"
          params={{ userId: user.id }}
          className="font-medium underline"
        >
          {user.displayName}
        </Link>
        <div className="text-xs text-muted">{user.email}</div>
      </td>
      <td className="px-3 py-2">{ROLE_LABELS[user.role]}</td>
      <td className="px-3 py-2">
        {STATUS_LABELS[user.status]}
        {user.status === 'pending' && (
          <div className="text-xs text-muted">
            {waiting ? 'Email confirmed, ready to approve' : 'Email not confirmed yet'}
          </div>
        )}
      </td>
      <td className="hidden px-3 py-2 md:table-cell">{formatDateTime(user.createdAt)}</td>
    </tr>
  );
}
