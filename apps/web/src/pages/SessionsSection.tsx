import type { SessionSummary } from '@lead/schema';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
    <Card className="mt-6 px-6">
      <section aria-labelledby="sessions-title">
        <h2 id="sessions-title" className="font-semibold">
          Signed-in devices
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign out anything you do not recognise, then change your password.
        </p>
        <div className="mt-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {result.status === 'loading' && <p role="status">Loading devices…</p>}
          {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
          {result.status === 'ready' && (
            <>
              <ul aria-label="Signed-in devices" className="stagger divide-y divide-border">
                {result.data.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm transition-colors hover:bg-accent/40"
                  >
                    <div>
                      <p className="font-medium">
                        {describeDevice(session.userAgent)}
                        {session.current && (
                          <Badge variant="secondary" className="ml-2 rounded-full">
                            this device
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last active {formatDateTime(session.lastActiveAt)}
                        {session.ipAddress && ` · ${session.ipAddress}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => signOutDevice(session)}
                      aria-disabled={busy}
                      aria-label={`Sign out ${describeDevice(session.userAgent)}${session.current ? ' (this device)' : ''}`}
                      variant="outline"
                      size="sm"
                    >
                      Sign out
                    </Button>
                  </li>
                ))}
              </ul>
              {result.data.some((session) => !session.current) && (
                <Button
                  type="button"
                  onClick={signOutOthers}
                  aria-disabled={busy}
                  variant="outline"
                  className="mt-4"
                >
                  Sign out all other devices
                </Button>
              )}
            </>
          )}
        </div>
      </section>
    </Card>
  );
}
