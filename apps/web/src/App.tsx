import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createAppRouter } from './router';
import { usePreviewRole } from './shell/preview-role';

interface AppProps {
  readonly history?: RouterHistory;
}

export function App({ history }: AppProps) {
  const { role } = usePreviewRole();
  const [router] = useState(() => createAppRouter(history));

  // Re-run route guards when the role changes (sign in / logout).
  useEffect(() => {
    void router.invalidate();
  }, [router, role]);

  return <RouterProvider router={router} context={{ role }} />;
}
