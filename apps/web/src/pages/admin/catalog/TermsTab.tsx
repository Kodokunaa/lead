import { SEMESTER_LABELS, SEMESTERS, type Term } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import {
  errorMessage,
  field,
  FormMessage,
  SELECT_CLASS,
  TextField,
} from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { formatDay } from '../../../components/format';

/** School terms; exactly one is current, and new sections default to it. */
export function TermsTab() {
  const auth = useAuth();
  const result = useApiData<Term[]>('/admin/terms');
  const [error, setError] = useState<string | null>(null);
  const semesterId = useId();

  const makeCurrent = (term: Term) => {
    setError(null);
    auth
      .request(`/admin/terms/${term.id}/make-current`, { method: 'POST' })
      .then(result.reload)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <FormDialog
          trigger={
            <>
              <Plus aria-hidden="true" /> Add term
            </>
          }
          title="Add a term"
          description="Make it current when classes start; new sections default to the current term."
          submitLabel="Add term"
          onSubmit={async (form) => {
            await auth.request('/admin/terms', {
              body: {
                schoolYear: field(form, 'schoolYear'),
                semester: field(form, 'semester'),
                startsOn: field(form, 'startsOn'),
                endsOn: field(form, 'endsOn'),
              },
            });
            result.reload();
          }}
        >
          <TextField label="School year" name="schoolYear" placeholder="2026-2027" required />
          <div className="flex flex-col gap-2">
            <Label htmlFor={semesterId}>Semester</Label>
            <select id={semesterId} name="semester" className={SELECT_CLASS}>
              {SEMESTERS.map((semester) => (
                <option key={semester} value={semester}>
                  {SEMESTER_LABELS[semester]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Starts on" name="startsOn" type="date" required />
            <TextField label="Ends on" name="endsOn" type="date" required />
          </div>
        </FormDialog>
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {result.status === 'loading' && <p role="status">Loading terms…</p>}
      {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
      {result.status === 'ready' &&
        (result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No terms yet. Add the current semester.</p>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableCaption className="sr-only">Academic terms</TableCaption>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    Term
                  </TableHead>
                  <TableHead scope="col">Dates</TableHead>
                  <TableHead scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="animate-fade">
                {result.data.map((term) => {
                  const name = `${SEMESTER_LABELS[term.semester]} ${term.schoolYear}`;
                  return (
                    <TableRow key={term.id} className="transition-colors hover:bg-accent/60">
                      <TableCell className="px-4 font-semibold whitespace-normal">
                        {name}
                        {term.current && (
                          <Badge className="ml-2 animate-glow rounded-full">Current</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {formatDay(term.startsOn)} – {formatDay(term.endsOn)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Link
                          to="/admin/courses/calendar"
                          search={{ term: term.id }}
                          className="link mr-3 text-sm"
                          aria-label={`Calendar for ${name}`}
                        >
                          Calendar
                        </Link>
                        {!term.current && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => makeCurrent(term)}
                            aria-label={`Make ${name} current`}
                          >
                            Make current
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        ))}
    </div>
  );
}
