import type { GradingQueue, QueueStatus } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
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
import { useApiData } from '../../../auth/use-api';
import { FormMessage, SELECT_CLASS, useFocusOnMount } from '../../../components/form';
import { formatDateTime } from '../../../components/format';

export const QUEUE_LABELS: Record<QueueStatus, string> = {
  needs_review: 'Needs review',
  draft_grade: 'Draft grade',
  released: 'Released',
  missing: 'Missing',
};

const QUEUE_STYLES: Record<QueueStatus, string> = {
  needs_review: 'border-orange-200 bg-accent text-brand-strong',
  draft_grade: 'border-sky-200 bg-sky-50 text-sky-800',
  released: 'border-green-200 bg-green-50 text-green-800',
  missing: 'border-red-200 bg-red-50 text-red-800',
};

function queuePath(section: string, status: string): string {
  const params = new URLSearchParams();
  if (section) params.set('section', section);
  if (status) params.set('status', status);
  const query = params.toString();
  return query ? `/teacher/grading?${query}` : '/teacher/grading';
}

/** T13 Submissions and grading queue. */
export function GradingQueuePage() {
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('');
  const result = useApiData<GradingQueue>(queuePath(section, status));
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const sectionId = useId();
  const statusId = useId();

  return (
    <section aria-labelledby="page-title" className="max-w-6xl">
      <p className="text-sm">
        <Link to="/teacher/assessments" className="link">
          Assessment management
        </Link>
      </p>
      <h1
        ref={heading}
        id="page-title"
        tabIndex={-1}
        className="mt-2 text-2xl font-bold outline-none"
      >
        Submissions and grading queue
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Current term · assignments and projects of your classes
      </p>

      <div className="mt-5 flex flex-wrap gap-4">
        <div className="flex flex-col gap-2 sm:w-72">
          <Label htmlFor={sectionId}>Class</Label>
          <select
            id={sectionId}
            value={section}
            onChange={(event) => setSection(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">All classes</option>
            {result.status === 'ready' &&
              result.data.classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.courseCode} · {item.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:w-56">
          <Label htmlFor={statusId}>Status</Label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {(Object.keys(QUEUE_LABELS) as QueueStatus[]).map((key) => (
              <option key={key} value={key}>
                {QUEUE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        {result.status === 'loading' ? (
          <p role="status">Loading the queue…</p>
        ) : result.status === 'error' ? (
          <FormMessage tone="error">{result.message}</FormMessage>
        ) : result.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here: no submissions match.</p>
        ) : (
          <Card className="animate-rise gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    Student
                  </TableHead>
                  <TableHead scope="col">Activity</TableHead>
                  <TableHead scope="col">Submitted</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.items.map((item) => (
                  <TableRow key={`${item.assessmentId}:${item.studentId}`}>
                    <th scope="row" className="px-4 text-left font-medium">
                      {item.studentName}
                    </th>
                    <TableCell className="whitespace-normal">
                      {item.title}
                      <span className="block text-xs text-muted-foreground">
                        {item.courseCode} · {item.sectionName}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.submittedAt ? formatDateTime(item.submittedAt) : '—'}
                      {item.late && (
                        <Badge
                          variant="outline"
                          className="ml-2 rounded-full border-red-200 bg-red-50 text-red-800"
                        >
                          Late
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`rounded-full ${QUEUE_STYLES[item.status]}`}
                      >
                        {QUEUE_LABELS[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.status === 'missing' ? (
                        <span className="text-muted-foreground">No submission</span>
                      ) : (
                        <Link
                          to="/teacher/grading/$assessmentId/$studentId"
                          params={{ assessmentId: item.assessmentId, studentId: item.studentId }}
                          className="link"
                          aria-label={`${item.status === 'needs_review' ? 'Grade' : 'Open'} ${item.studentName}, ${item.title}`}
                        >
                          {item.status === 'needs_review' ? 'Grade' : 'Open'}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </section>
  );
}
