import {
  ASSESSMENT_KIND_LABELS,
  ASSESSMENT_KINDS,
  type AssessmentDetails,
  type AssessmentList,
} from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { field, FormMessage, SELECT_CLASS, TextField } from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { formatDateTime } from '../../../components/format';
import { AvailabilityBadge } from './shared';

/** T08 Assessment management: the teacher's assessments this term, by class. */
export function AssessmentsPage() {
  const [sectionId, setSectionId] = useState('');
  const result = useApiData<AssessmentList>(
    sectionId ? `/teacher/assessments?section=${sectionId}` : '/teacher/assessments',
  );
  const filterId = useId();

  return (
    <section aria-labelledby="page-title" className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="page-title" className="text-2xl font-bold">
            Assessment management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Current term · quizzes, examinations, assignments and projects of your classes
          </p>
        </div>
        <CreateDialog classes={result.status === 'ready' ? result.data.classes : null} />
      </div>

      {result.status === 'ready' && result.data.classes.length > 1 && (
        <div className="mt-5 flex flex-col gap-2 sm:w-80">
          <Label htmlFor={filterId}>Class</Label>
          <select
            id={filterId}
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">All classes</option>
            {result.data.classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.courseCode} · {item.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5">
        {result.status === 'loading' ? (
          <p role="status">Loading assessments…</p>
        ) : result.status === 'error' ? (
          <FormMessage tone="error">{result.message}</FormMessage>
        ) : result.data.classes.length === 0 && result.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no classes this term. An administrator assigns them under Section Management.
          </p>
        ) : result.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments yet. Create the first one.</p>
        ) : (
          <AssessmentTable list={result.data} />
        )}
      </div>
    </section>
  );
}

function AssessmentTable({ list }: { list: AssessmentList }) {
  return (
    <Card className="animate-rise gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead scope="col" className="px-4">
              Title
            </TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Class</TableHead>
            <TableHead scope="col">Objectives</TableHead>
            <TableHead scope="col">Due</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.items.map((item) => (
            <TableRow key={item.id}>
              <th scope="row" className="px-4 text-left align-middle font-medium whitespace-normal">
                {item.title}
              </th>
              <TableCell>{ASSESSMENT_KIND_LABELS[item.kind]}</TableCell>
              <TableCell>
                {item.courseCode} · {item.sectionName}
              </TableCell>
              <TableCell>{item.objectiveCodes.join(', ') || '—'}</TableCell>
              <TableCell>{item.dueAt ? formatDateTime(item.dueAt) : 'Not set'}</TableCell>
              <TableCell>
                <AvailabilityBadge assessment={item} />
              </TableCell>
              <TableCell>
                {item.status === 'draft' ? (
                  <Link
                    to="/teacher/assessments/$assessmentId"
                    params={{ assessmentId: item.id }}
                    className="link"
                    aria-label={`Edit ${item.title}`}
                  >
                    Edit
                  </Link>
                ) : (
                  <Link
                    to="/teacher/assessments/$assessmentId/review"
                    params={{ assessmentId: item.id }}
                    className="link"
                    aria-label={`View ${item.title}`}
                  >
                    View
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function CreateDialog({ classes }: { classes: AssessmentList['classes'] | null }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const classId = useId();
  const kindId = useId();

  return (
    <FormDialog
      trigger={
        <>
          <Plus aria-hidden="true" /> Create assessment
        </>
      }
      disabled={!classes || classes.length === 0}
      title="Create an assessment"
      description="It starts as a draft: set its dates, questions or rubric, then review and publish it."
      submitLabel="Create draft"
      onSubmit={async (form) => {
        const created = await auth.request<AssessmentDetails>('/teacher/assessments', {
          method: 'POST',
          body: {
            sectionId: field(form, 'sectionId'),
            kind: field(form, 'kind'),
            title: field(form, 'title'),
          },
        });
        await navigate({
          to: '/teacher/assessments/$assessmentId',
          params: { assessmentId: created.id },
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={classId}>Class</Label>
        <select id={classId} name="sectionId" required className={SELECT_CLASS}>
          {(classes ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.courseCode} – {item.courseTitle} · {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={kindId}>Type</Label>
        <select id={kindId} name="kind" required className={SELECT_CLASS}>
          {ASSESSMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ASSESSMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      <TextField label="Title" name="title" required maxLength={120} />
    </FormDialog>
  );
}
