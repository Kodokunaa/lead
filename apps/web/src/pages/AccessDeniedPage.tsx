import { homePathFor, type Role } from '@lead/schema';
import { Link } from '@tanstack/react-router';

/** X04: shown when a signed-in user opens a page their role cannot use. */
export function AccessDeniedPage({ role }: { role: Role }) {
  return (
    <section aria-labelledby="page-title" className="max-w-xl">
      <h1 id="page-title" className="text-2xl font-bold">
        You do not have access to this page
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account cannot open it. If you think you should have access, ask an administrator to
        check your role.
      </p>
      <p className="mt-6">
        <Link to={homePathFor(role)} className="link">
          Go to your dashboard
        </Link>
      </p>
    </section>
  );
}
