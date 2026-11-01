import type { SessionSummary } from '@lead/schema';
import { useState } from 'react';
import { useAuth } from '../auth/session';
import { useApiData } from '../auth/use-api';
import { errorMessage, FormMessage } from '../components/form';
import { describeDevice, formatDateTime } from '../components/format';

/** H08: the devices signed in to this account, each with a sign-out button. */
export function SessionsSection() {
  const auth = useAuth();
  const result = useApiData<SessionSummary[]>('/me/sessions');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** `task` resolves to whether the list should be reloaded afterwards. */
  const run = (task: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    task()
      .then((reload) => {
        if (reload) result.reload();
      })
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setBusy(false));
  };

  const signOutDevice = (session: SessionSummary) =>
    run(async () => {
      await auth.request(`/me/sessions/${session.id}/revoke`, { method: 'POST' });
      // Ending this browser's own session is a sign-out here too; nothing left to reload.
      if (session.current) {
        auth.endLocalSession(true);
        return false;
      }
      return true;
    });

  const signOutOthers = () =>
    run(async () => {
      await auth.request('/me/sessions/revoke-others', { method: 'POST' });
      return true;
    });

  return (
    <section
      aria-labelledby="sessions-title"
      className="mt-6 rounded-lg border border-border bg-surface p-6"
    >
      <h2 id="sessions-title" className="font-semibold">
        Signed-in devices
      </h2>
      <p className="mt-1 text-sm text-muted">
        Sign out anything you do not recognise, then change your password.
      </p>
      <div className="mt-4">
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {result.status === 'loading' && <p role="status">Loading devices…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' && (
          <>
            <ul aria-label="Signed-in devices" className="divide-y divide-border">
              {result.data.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {describeDevice(session.userAgent)}
                      {session.current && (
                        <span className="ml-1 text-xs text-muted"> (this device)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      Last active {formatDateTime(session.lastActiveAt)}
                      {session.ipAddress && ` · ${session.ipAddress}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => signOutDevice(session)}
                    aria-disabled={busy}
                    aria-label={`Sign out ${describeDevice(session.userAgent)}${session.current ? ' (this device)' : ''}`}
                    className="rounded-md border border-border px-3 py-1"
                  >
                    Sign out
                  </button>
                </li>
              ))}
            </ul>
            {result.data.some((session) => !session.current) && (
              <button
                type="button"
                onClick={signOutOthers}
                aria-disabled={busy}
                className="mt-4 rounded-md border border-border px-3 py-2 text-sm"
              >
                Sign out all other devices
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
