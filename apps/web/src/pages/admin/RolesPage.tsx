import { ROLE_LABELS, ROLES, type Role } from '@lead/schema';

/** What each role may do today. Grows with each phase; the API enforces it, not this page. */
const CAPABILITIES: readonly { label: string; roles: readonly Role[] }[] = [
  { label: 'Sign in, set up two-step verification, manage own devices', roles: ROLES },
  { label: 'Request an account by self-registration', roles: ['student', 'teacher'] },
  { label: 'Approve registrations', roles: ['admin'] },
  { label: 'Change roles, deactivate or reactivate accounts (with a reason)', roles: ['admin'] },
  { label: 'Reset another user’s two-step verification (with a reason)', roles: ['admin'] },
];

/** A04: a read-only view of the role model until custom permissions arrive. */
export function RolesPage() {
  return (
    <section aria-labelledby="page-title" className="max-w-3xl">
      <h1 id="page-title" className="text-2xl font-bold">
        Roles & Permissions
      </h1>
      <p className="mt-1 text-sm text-muted">
        LEAD has three fixed roles. Administrators cannot register themselves; another administrator
        assigns the role. This table grows as course, grading and analytics features arrive.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">What each role can do</caption>
          <thead className="border-b border-border text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Permission
              </th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-3 py-2 text-center font-medium">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability.label} className="border-b border-border last:border-0">
                <th scope="row" className="px-3 py-2 font-normal">
                  {capability.label}
                </th>
                {ROLES.map((role) => (
                  <td key={role} className="px-3 py-2 text-center">
                    {capability.roles.includes(role) ? (
                      <>
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">Yes</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" className="text-muted">
                          –
                        </span>
                        <span className="sr-only">No</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
