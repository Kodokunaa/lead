import { ROLE_LABELS, ROLES, type UserDetails } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../auth/session';
import { useApiData } from '../../auth/use-api';
import { field, FormMessage, SubmitButton, TextField, useFormAction } from '../../components/form';
import { describeAction, formatDateTime } from '../../components/format';
import { StatusBadge } from './StatusBadge';

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
        <Link to="/admin/users" className="link">
          User Management
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        {user.displayName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone="success">
            {notice.text}
          </FormMessage>
        </div>
      )}

      <Card className="mt-6 py-5">
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <Fact label="Role">{ROLE_LABELS[user.role]}</Fact>
            <Fact label="Status">
              <StatusBadge status={user.status} />
            </Fact>
            <Fact label="Email">{user.emailVerified ? 'Confirmed' : 'Not confirmed'}</Fact>
            <Fact label="Two-step verification">
              <Badge variant={user.mfaEnabled ? 'default' : 'secondary'} className="rounded-full">
                {user.mfaEnabled ? 'On' : 'Off'}
              </Badge>
            </Fact>
            <Fact label="Signed-in devices">{user.activeSessions}</Fact>
            <Fact label="Last sign-in">
              {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Never'}
            </Fact>
            {user.lockedUntil && (
              <Fact label="Locked until">{formatDateTime(user.lockedUntil)}</Fact>
            )}
          </dl>
        </CardContent>
      </Card>

      {user.id === currentUserId ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This is your account. Another administrator must change its role or access.
        </p>
      ) : (
        <AccountActions user={user} onStart={started} onDone={done} />
      )}

      <h2 className="mt-8 font-semibold">Recent activity</h2>
      {user.activity.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <Card className="mt-2 gap-0 py-0">
          <ol className="stagger divide-y divide-border text-sm">
            {user.activity.map((event) => (
              <li key={event.id} className="px-4 py-2">
                <span className="font-medium">{describeAction(event.action)}</span>
                {event.outcome !== 'success' && (
                  <span className="text-danger"> ({event.outcome})</span>
                )}
                <span className="text-muted-foreground">
                  {' · '}
                  {formatDateTime(event.occurredAt)}
                  {event.actorName && ` · by ${event.actorName}`}
                </span>
                {event.reason && (
                  <div className="text-muted-foreground">Reason: {event.reason}</div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
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
    <div className="stagger mt-6 grid gap-4">
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
      <Label htmlFor={id}>New role</Label>
      <select
        id={id}
        name="role"
        defaultValue={ROLES.find((role) => role !== current)}
        className="h-11 rounded-xl border border-input bg-background px-4 text-sm shadow-xs transition-[color,box-shadow] focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:outline-none"
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
    <Card className="card-interactive gap-4">
      <CardHeader>
        <CardTitle>
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          aria-labelledby={headingId}
          className="flex flex-col gap-3"
          noValidate
        >
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
      </CardContent>
    </Card>
  );
}
