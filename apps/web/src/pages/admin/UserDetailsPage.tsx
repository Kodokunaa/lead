import { ROLE_LABELS, ROLES, type UserDetails } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/session';
import { useApiData } from '../../auth/use-api';
import { field, FormMessage, SubmitButton, TextField, useFormAction } from '../../components/form';
import { describeAction, formatDateTime } from '../../components/format';
import { STATUS_LABELS } from './UsersPage';

interface UserDetailsPageProps {
  readonly userId: string;
  /** The signed-in administrator; they cannot change their own account here. */
  readonly currentUserId: string;
}

/** A03 account details and the changes an administrator can make (each with a reason). */
export function UserDetailsPage({ userId, currentUserId }: UserDetailsPageProps) {
  const result = useApiData<UserDetails>(`/admin/users/${userId}`);
  // A counter key re-mounts the message, so the same text is announced again next time.
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);

  if (result.status === 'loading') return <p role="status">Loading account…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const user = result.data;

  const done = (text: string) => {
    setNotice((previous) => ({ text, key: (previous?.key ?? 0) + 1 }));
    result.reload();
  };
  const started = () => setNotice(null);

  return (
    <section aria-labelledby="page-title" className="max-w-3xl">
      <p className="text-sm">
        <Link to="/admin/users" className="underline">
          User Management
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        {user.displayName}
      </h1>
      <p className="mt-1 text-sm text-muted">{user.email}</p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone="success">
            {notice.text}
          </FormMessage>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 text-sm md:grid-cols-3">
        <Fact label="Role">{ROLE_LABELS[user.role]}</Fact>
        <Fact label="Status">{STATUS_LABELS[user.status]}</Fact>
        <Fact label="Email">{user.emailVerified ? 'Confirmed' : 'Not confirmed'}</Fact>
        <Fact label="Two-step verification">{user.mfaEnabled ? 'On' : 'Off'}</Fact>
        <Fact label="Signed-in devices">{user.activeSessions}</Fact>
        <Fact label="Last sign-in">
          {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Never'}
        </Fact>
        {user.lockedUntil && <Fact label="Locked until">{formatDateTime(user.lockedUntil)}</Fact>}
      </dl>

      {user.id === currentUserId ? (
        <p className="mt-6 text-sm text-muted">
          This is your account. Another administrator must change its role or access.
        </p>
      ) : (
        <AccountActions user={user} onStart={started} onDone={done} />
      )}

      <h2 className="mt-8 font-semibold">Recent activity</h2>
      {user.activity.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No activity yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-sm">
          {user.activity.map((event) => (
            <li key={event.id} className="px-4 py-2">
              <span className="font-medium">{describeAction(event.action)}</span>
              {event.outcome !== 'success' && (
                <span className="text-danger"> ({event.outcome})</span>
              )}
              <span className="text-muted">
                {' · '}
                {formatDateTime(event.occurredAt)}
                {event.actorName && ` · by ${event.actorName}`}
              </span>
              {event.reason && <div className="text-muted">Reason: {event.reason}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

interface AccountActionsProps {
  readonly user: UserDetails;
  readonly onStart: () => void;
  readonly onDone: (message: string) => void;
}

function AccountActions({ user, onStart, onDone }: AccountActionsProps) {
  const waiting = user.status === 'pending' && user.emailVerified;
  return (
    <div className="mt-6 grid gap-4">
      {waiting && (
        <ActionForm
          title="Approve this account"
          description="They can sign in right away and get an email saying so."
          action="Approve"
          path={`/admin/users/${user.id}/approve`}
          needsReason={false}
          onStart={onStart}
          onDone={() => onDone('Account approved.')}
        />
      )}
      {user.status === 'pending' && (
        <ActionForm
          title="Reject this registration"
          action="Reject"
          path={`/admin/users/${user.id}/reject`}
          onStart={onStart}
          onDone={() => onDone('Registration rejected.')}
        />
      )}
      {user.status === 'active' && (
        <>
          <ActionForm
            title="Change role"
            description="They are signed out everywhere and get the new role at their next sign-in."
            action="Change role"
            path={`/admin/users/${user.id}/role`}
            extra={<RoleSelect current={user.role} />}
            onStart={onStart}
            onDone={() => onDone('Role changed.')}
          />
          {user.mfaEnabled && (
            <ActionForm
              title="Reset two-step verification"
              description="For someone who lost their phone and recovery codes. Check their identity first."
              action="Reset two-step verification"
              path={`/admin/users/${user.id}/mfa/reset`}
              needsPassword
              onStart={onStart}
              onDone={() => onDone('Two-step verification reset.')}
            />
          )}
          <ActionForm
            title="Deactivate account"
            description="They are signed out everywhere and cannot sign in until reactivated."
            action="Deactivate"
            path={`/admin/users/${user.id}/deactivate`}
            onStart={onStart}
            onDone={() => onDone('Account deactivated.')}
          />
        </>
      )}
      {user.status === 'deactivated' && user.emailVerified && (
        <ActionForm
          title="Reactivate account"
          action="Reactivate"
          path={`/admin/users/${user.id}/reactivate`}
          onStart={onStart}
          onDone={() => onDone('Account reactivated.')}
        />
      )}
    </div>
  );
}

function RoleSelect({ current }: { current: UserDetails['role'] }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        New role
      </label>
      <select
        id={id}
        name="role"
        defaultValue={ROLES.find((role) => role !== current)}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
      >
        {ROLES.filter((role) => role !== current).map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ActionFormProps {
  readonly title: string;
  readonly description?: string;
  readonly action: string;
  readonly path: string;
  readonly needsReason?: boolean;
  readonly extra?: ReactNode;
  /** Also asks for the administrator's own password (MFA reset). */
  readonly needsPassword?: boolean;
  readonly onStart: () => void;
  readonly onDone: () => void;
}

function ActionForm({
  title,
  description,
  action,
  path,
  needsReason = true,
  extra,
  needsPassword = false,
  onStart,
  onDone,
}: ActionFormProps) {
  const auth = useAuth();
  const headingId = useId();
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    onStart();
    const body: Record<string, string> = {};
    if (needsReason) body.reason = field(form, 'reason');
    if (extra) body.role = field(form, 'role');
    if (needsPassword) body.password = field(form, 'password');
    await auth.request(path, { body });
    onDone();
  });

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      noValidate
    >
      <h2 id={headingId} className="font-semibold">
        {title}
      </h2>
      {description && <p className="text-sm text-muted">{description}</p>}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {extra}
      {needsReason && (
        <TextField
          label="Reason"
          name="reason"
          hint="Recorded in the audit log."
          required
          minLength={3}
        />
      )}
      {needsPassword && (
        <TextField
          label="Your password"
          name="password"
          type="password"
          autoComplete="current-password"
          hint="Confirms it is really you before removing someone's second factor."
          required
        />
      )}
      <div>
        <SubmitButton busy={busy}>{action}</SubmitButton>
      </div>
    </form>
  );
}
