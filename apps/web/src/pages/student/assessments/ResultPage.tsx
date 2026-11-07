import type { AttemptResult } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiData } from '../../../auth/use-api';
import { countOf, formatDateTime } from '../../../components/format';
import { PageShell, StateShell } from '../CoursePages';
import { BackToAssessment } from './AttemptPage';

/** Share of multiple-choice questions answered correctly that counts as meeting the objective. */
const MET_SHARE = 0.75;

type Objective = AttemptResult['objectives'][number];

/** A plain reading of the evidence; never a final grade. */
export function interpretation(objective: Objective): string {
  if (objective.scored === 0) return 'Awaiting teacher grading';
  return objective.correct / objective.scored >= MET_SHARE
    ? 'Criterion met'
    : 'Needs targeted practice';
}

/** S11 Assessment result and feedback. */
export function AttemptResultPage({ attemptId }: { attemptId: string }) {
  const result = useApiData<AttemptResult>(`/student/attempts/${attemptId}/result`);
  if (result.status !== 'ready') {
    return (
      <StateShell
        back={
          <Link to="/student/assessments" className="link">
            Assessments and activities
          </Link>
        }
        title="Assessment result and feedback"
        state={result}
      />
    );
  }
  const data = result.data;
  const percent = data.scoredPoints > 0 ? Math.round((data.score / data.scoredPoints) * 100) : null;

  return (
    <PageShell
      back={<BackToAssessment assessmentId={data.assessmentId} />}
      title="Assessment result and feedback"
      subtitle={`${data.courseCode} · ${data.sectionName} · ${data.title}, attempt ${data.number}`}
    >
      <div className="stagger mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Submitted</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              {formatDateTime(data.submittedAt)}
              {data.autoSubmitted ? ' (time ran out; your saved answers were submitted)' : ''}
            </p>
            <p>
              Answered {data.answered} of {countOf(data.questionCount, 'question')}
            </p>
            {data.scoredPoints > 0 && (
              <p className="text-base font-semibold">
                Multiple choice: {data.score} / {data.scoredPoints}
                {percent !== null && ` (${percent}%)`}
              </p>
            )}
            {data.grade ? (
              <div className="flex flex-col gap-1 rounded-xl border border-green-200 bg-green-50 p-3">
                <p className="text-base font-semibold">
                  Total graded by your teacher: {data.grade.score} / {data.grade.maxPoints}
                </p>
                {data.grade.written.map((item) => (
                  <p key={item.position}>
                    Written question {item.position}: {item.points} / {item.maxPoints}
                  </p>
                ))}
                {data.grade.feedback && (
                  <p className="break-words whitespace-pre-wrap">Feedback: {data.grade.feedback}</p>
                )}
                <p className="text-muted-foreground">
                  Released {formatDateTime(data.grade.releasedAt)}
                </p>
              </div>
            ) : (
              <>
                {data.pendingPoints > 0 && (
                  <p>
                    Written answers: {countOf(data.pendingPoints, 'point')} awaiting teacher grading
                  </p>
                )}
                <p className="text-muted-foreground">
                  This is not your official grade: your teacher reviews and releases final grades.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Next steps</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>Review the course materials for any objective that needs practice.</p>
            <Link
              to="/student/courses/$sectionId"
              params={{ sectionId: data.sectionId }}
              className="link"
            >
              Open the course
            </Link>
            {data.canRetake ? (
              <Link
                to="/student/assessments/$assessmentId"
                params={{ assessmentId: data.assessmentId }}
                className="link"
              >
                Try again ({data.attemptsUsed} of {data.maxAttempts} attempts used)
              </Link>
            ) : (
              <p className="text-muted-foreground">
                {data.attemptsUsed} of {data.maxAttempts} attempts used.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-rise mt-6 gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Objective
              </TableHead>
              <TableHead scope="col">Evidence</TableHead>
              <TableHead scope="col">Current interpretation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.objectives.map((objective) => (
              <TableRow key={objective.code}>
                <th scope="row" className="px-4 text-left font-medium whitespace-normal">
                  {objective.code} / {objective.description}
                </th>
                <TableCell className="whitespace-normal">
                  {objective.scored > 0 && `${objective.correct} / ${objective.scored} correct`}
                  {objective.scored > 0 && objective.pending > 0 && ' · '}
                  {objective.pending > 0 &&
                    `${countOf(objective.pending, 'written answer')} pending`}
                  {objective.scored === 0 && objective.pending === 0 && 'No questions'}
                </TableCell>
                <TableCell>{interpretation(objective)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </PageShell>
  );
}
