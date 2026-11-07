import { ASSESSMENT_KIND_LABELS, type StudentAssessmentSummary } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiData } from '../../../auth/use-api';
import { FormMessage } from '../../../components/form';
import { formatDateTime } from '../../../components/format';
import { StateBadge } from './shared';

const ACTIONS: Record<StudentAssessmentSummary['state'], string> = {
  scheduled: 'View',
  available: 'Start',
  in_progress: 'Continue',
  submitted: 'View',
  missed: 'View',
};

/** S07 Assessments and activities: published quizzes and examinations of my classes. */
export function StudentAssessmentsPage() {
  const result = useApiData<StudentAssessmentSummary[]>('/student/assessments');
  return (
    <section aria-labelledby="page-title" className="max-w-6xl">
      <h1 id="page-title" className="text-2xl font-bold">
        Assessments and activities
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Quizzes and examinations of the classes you are enrolled in
      </p>
      <div className="mt-5">
        {result.status === 'loading' ? (
          <p role="status">Loading assessments…</p>
        ) : result.status === 'error' ? (
          <FormMessage tone="error">{result.message}</FormMessage>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No quizzes or examinations yet. They appear here once your teachers publish them.
          </p>
        ) : (
          <Card className="animate-rise gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    Activity
                  </TableHead>
                  <TableHead scope="col">Class</TableHead>
                  <TableHead scope="col">Objectives</TableHead>
                  <TableHead scope="col">Due</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((item) => (
                  <TableRow key={item.id}>
                    <th
                      scope="row"
                      className="px-4 text-left align-middle font-medium whitespace-normal"
                    >
                      {item.title}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {ASSESSMENT_KIND_LABELS[item.kind]}
                      </span>
                    </th>
                    <TableCell>
                      {item.courseCode} · {item.sectionName}
                    </TableCell>
                    <TableCell>{item.objectiveCodes.join(', ') || '—'}</TableCell>
                    <TableCell>{formatDateTime(item.dueAt)}</TableCell>
                    <TableCell>
                      <StateBadge state={item.state} />
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/student/assessments/$assessmentId"
                        params={{ assessmentId: item.id }}
                        className="link"
                        aria-label={`${ACTIONS[item.state]} ${item.title}`}
                      >
                        {ACTIONS[item.state]}
                      </Link>
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
