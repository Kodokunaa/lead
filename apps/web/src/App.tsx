import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
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
      <p role="status" className="grid min-h-full place-items-center text-sm text-muted">
        Loading…
      </p>
    );
  }
  if (session.status === 'unavailable') {
    return (
      <div role="alert" className="grid min-h-full place-items-center px-4 text-center">
        <div>
          <p className="font-semibold">LEAD could not reach its server.</p>
          <p className="mt-1 text-sm text-muted">Check your connection, then try again.</p>
          <button
            type="button"
            onClick={() => void auth.start()}
            className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-text"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <RouterProvider router={router} context={{ session }} />;
}
