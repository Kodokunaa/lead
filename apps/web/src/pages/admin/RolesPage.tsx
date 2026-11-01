import { ROLE_LABELS, ROLES, type Role } from '@lead/schema';
import { Check, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
      <p className="mt-1 text-sm text-muted-foreground">
        LEAD has three fixed roles. Administrators cannot register themselves; another administrator
        assigns the role. This table grows as course, grading and analytics features arrive.
      </p>
      <Card className="mt-6 gap-0 overflow-hidden py-0">
        <Table>
          <TableCaption className="sr-only">What each role can do</TableCaption>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Permission
              </TableHead>
              {ROLES.map((role) => (
                <TableHead key={role} scope="col" className="text-center">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="animate-fade">
            {CAPABILITIES.map((capability) => (
              <TableRow key={capability.label}>
                <TableHead
                  scope="row"
                  className="px-4 font-normal whitespace-normal text-foreground"
                >
                  {capability.label}
                </TableHead>
                {ROLES.map((role) => (
                  <TableCell key={role} className="text-center">
                    {capability.roles.includes(role) ? (
                      <>
                        <Check aria-hidden="true" className="mx-auto size-5 text-brand-strong" />
                        <span className="sr-only">Yes</span>
                      </>
                    ) : (
                      <>
                        <Minus
                          aria-hidden="true"
                          className="mx-auto size-4 text-muted-foreground"
                        />
                        <span className="sr-only">No</span>
                      </>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
