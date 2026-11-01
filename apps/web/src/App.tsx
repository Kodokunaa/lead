import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth, useSession } from './auth/session';
import { createAppRouter } from './router';

interface AppProps {
  readonly history?: RouterHistory;
}

export function App({ history }: AppProps) {
  const session = useSession();
  const auth = useAuth();
  const [router] = useState(() => createAppRouter(history));

  // Re-run route guards when who is signed in changes (sign in, sign out, another tab), not on
  // every user reload. Not while loading: guards would treat the visitor as signed out.
  const identity =
    session.status === 'signed-in' ? `${session.user.id}:${session.user.role}` : session.status;
  useEffect(() => {
    if (identity !== 'loading') void router.invalidate();
  }, [router, identity]);

  if (session.status === 'loading') {
    return (
      <p role="status" className="grid min-h-full place-items-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (session.status === 'unavailable') {
    return (
      <div role="alert" className="grid min-h-full place-items-center px-4 text-center">
        <div>
          <p className="font-semibold">LEAD could not reach its server.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection, then try again.
          </p>
          <Button type="button" className="mt-4" onClick={() => void auth.start()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return <RouterProvider router={router} context={{ session }} />;
}
