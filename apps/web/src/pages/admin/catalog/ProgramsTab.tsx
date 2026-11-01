import type { Program } from '@lead/schema';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { errorMessage, field, FormMessage, TextField } from '../../../components/form';
import { FormDialog } from './FormDialog';

/** CCC's degree programs. Deactivating one stops new courses going under it. */
export function ProgramsTab() {
  const auth = useAuth();
  const result = useApiData<Program[]>('/admin/programs');
  const [error, setError] = useState<string | null>(null);

  const toggle = (program: Program) => {
    setError(null);
    auth
      .request(`/admin/programs/${program.id}`, {
        method: 'PATCH',
        body: { active: !program.active },
      })
      .then(result.reload)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <FormDialog
          trigger={
            <>
              <Plus aria-hidden="true" /> Add program
            </>
          }
          title="Add a program"
          description="New courses can then be placed under it."
          submitLabel="Add program"
          onSubmit={async (form) => {
            await auth.request('/admin/programs', {
              body: { code: field(form, 'code'), name: field(form, 'name') },
            });
            result.reload();
          }}
        >
          <TextField
            label="Program code"
            name="code"
            hint='As CCC writes it, e.g. "BSED Math".'
            required
          />
          <TextField label="Program name" name="name" required />
        </FormDialog>
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {result.status === 'loading' && <p role="status">Loading programs…</p>}
      {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
      {result.status === 'ready' && (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableCaption className="sr-only">Programs</TableCaption>
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead scope="col" className="px-4">
                  Code
                </TableHead>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="animate-fade">
              {result.data.map((program) => (
                <TableRow key={program.id} className="transition-colors hover:bg-accent/60">
                  <TableCell className="px-4 font-semibold">{program.code}</TableCell>
                  <TableCell className="whitespace-normal">{program.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={program.active ? 'outline' : 'secondary'}
                      className={
                        program.active
                          ? 'rounded-full border-green-200 bg-green-50 text-green-800'
                          : 'rounded-full'
                      }
                    >
                      {program.active ? 'Offered' : 'Not offered'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggle(program)}
                      aria-label={`${program.active ? 'Stop offering' : 'Offer'} ${program.code}`}
                    >
                      {program.active ? 'Stop offering' : 'Offer again'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
