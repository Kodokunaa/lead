import {
  ASSESSMENT_KIND_LABELS,
  MAX_RESOURCE_BYTES,
  RESOURCE_FILE_TYPES,
  type StudentAssignment,
  type SubmissionFile,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { downloadFile } from '../../../components/download';
import { errorMessage, FormMessage, SubmitButton, useFormAction } from '../../../components/form';
import { formatDateTime } from '../../../components/format';
import { formatBytes } from '../../resources/shared';
import { nextNotice, type Notice } from '../../teacher/content/shared';
import { PageShell, StateShell } from '../CoursePages';

const ACCEPT = Object.keys(RESOURCE_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');
const FILE_HINT = `PDF, PNG or JPEG, Word, PowerPoint, Excel or text; up to ${formatBytes(MAX_RESOURCE_BYTES)}.`;

function BackToAssessments() {
  return (
    <Link to="/student/assessments" className="link">
      Assessments and activities
    </Link>
  );
}

/** S12 Assignment or project submission. */
export function AssignmentPage({ assessmentId }: { assessmentId: string }) {
  const result = useApiData<StudentAssignment>(`/student/assignments/${assessmentId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (result.status !== 'ready') {
    return (
      <StateShell
        back={<BackToAssessments />}
        title="Assignment or project submission"
        state={result}
      />
    );
  }
  const work = result.data;
  const draft = work.submissions.find((item) => item.status === 'draft');
  const submitted = work.submissions.filter((item) => item.status === 'submitted');
  const announce = (text: string) => {
    setNotice((previous) => nextNotice(previous, text));
    result.reload();
  };

  return (
    <PageShell
      back={<BackToAssessments />}
      title="Assignment or project submission"
      subtitle={`${work.courseCode} – ${work.courseTitle} · ${work.sectionName}`}
    >
      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}
      {result.refreshError && (
        <div className="mt-4">
          <FormMessage tone="error">Could not reload: {result.refreshError}</FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">
                {work.title} / {ASSESSMENT_KIND_LABELS[work.kind].toLowerCase()}
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {work.objectives.map((objective) => (
              <p key={objective.code}>
                Objective {objective.code} / {objective.description}
              </p>
            ))}
            <p>
              Due {formatDateTime(work.dueAt)}
              {work.acceptLate ? ' (late work accepted, marked late)' : ''}
            </p>
            {work.instructions && (
              <p className="break-words whitespace-pre-wrap">{work.instructions}</p>
            )}
            <RubricTable work={work} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="card-interactive">
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-semibold">Submission status</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                {submitted.length > 0
                  ? `Submitted ${submitted.length} of ${work.maxSubmissions} allowed`
                  : draft
                    ? 'Draft / not yet submitted'
                    : 'Not yet submitted'}
              </p>
              {submitted.map((item) => (
                <FileLine key={item.id} file={item} />
              ))}
              {work.grade ? (
                <GradeSummary work={work} />
              ) : (
                submitted.length > 0 && (
                  <p className="text-muted-foreground">After grading: score and feedback here.</p>
                )
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {work.blockedReason ? (
        <p className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm">{work.blockedReason}</p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <UploadCard
            // Empty again after each saved draft.
            key={draft?.savedAt ?? 'none'}
            work={work}
            hasDraft={draft !== undefined}
            onSaved={announce}
          />
          {draft && <ConfirmCard work={work} draft={draft} onSubmitted={announce} />}
        </div>
      )}
    </PageShell>
  );
}

function RubricTable({ work }: { work: StudentAssignment }) {
  if (work.rubric.length === 0) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <Table>
        <caption className="caption-top pb-2 text-left text-sm font-medium">
          Rubric ({work.points} points)
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Criterion</TableHead>
            <TableHead scope="col">Levels</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {work.rubric.map((criterion) => (
            <TableRow key={criterion.id}>
              <th scope="row" className="pr-3 text-left align-top font-medium">
                {criterion.name}
              </th>
              <TableCell className="whitespace-normal">
                <ul className="flex flex-col gap-1">
                  {criterion.levels.map((level) => (
                    <li key={level.id}>
                      <span className="font-medium">
                        {level.label} / {level.points}
                      </span>
                      {level.descriptor && ` – ${level.descriptor}`}
                    </li>
                  ))}
                </ul>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FileLine({ file }: { file: SubmissionFile }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <p>
        {file.status === 'submitted' ? `Submission ${file.number}: ` : 'Draft: '}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-brand-strong"
          onClick={() => {
            setError(null);
            void downloadFile(auth, `/student/submissions/${file.id}/file`, file.fileName).catch(
              (failure: unknown) => setError(errorMessage(failure)),
            );
          }}
        >
          {file.fileName}
        </Button>{' '}
        ({formatBytes(file.sizeBytes)})
      </p>
      <p className="text-muted-foreground">
        {file.submittedAt
          ? `Received ${formatDateTime(file.submittedAt)}${file.late ? ' · late' : ''}`
          : `Saved ${formatDateTime(file.savedAt)}`}
      </p>
      {error && (
        <p role="alert" className="font-medium text-red-800">
          Download failed: {error}
        </p>
      )}
    </div>
  );
}

function GradeSummary({ work }: { work: StudentAssignment }) {
  const grade = work.grade!;
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-xl border border-green-200 bg-green-50 p-3">
      <p className="font-semibold">
        Score: {grade.score} / {grade.maxPoints}
        {grade.submissionNumber ? ` (submission ${grade.submissionNumber})` : ''}
      </p>
      <ul>
        {grade.levels.map((item) => (
          <li key={item.criterion}>
            {item.criterion}: {item.level} / {item.points}
          </li>
        ))}
      </ul>
      {grade.feedback && (
        <p className="break-words whitespace-pre-wrap">Feedback: {grade.feedback}</p>
      )}
      <p className="text-muted-foreground">Released {formatDateTime(grade.releasedAt)}</p>
    </div>
  );
}

interface UploadProps {
  readonly work: StudentAssignment;
  readonly hasDraft: boolean;
  readonly onSaved: (text: string) => void;
}

function UploadCard({ work, hasDraft, onSaved }: UploadProps) {
  const auth = useAuth();
  const fileId = useId();
  const noteId = useId();
  const hintId = useId();
  const [tooBig, setTooBig] = useState(false);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/student/assignments/${work.id}/draft`, { method: 'POST', body: form });
    onSaved(hasDraft ? 'Draft replaced.' : 'Draft saved. Review it, then confirm your submission.');
  });
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Upload submission</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <div className="flex flex-col gap-2">
            <Label htmlFor={fileId}>File</Label>
            <input
              id={fileId}
              name="file"
              type="file"
              required
              accept={ACCEPT}
              aria-describedby={hintId}
              onChange={(event) => {
                // Too-large files are stopped here, before the whole file is sent.
                const big = (event.currentTarget.files?.[0]?.size ?? 0) > MAX_RESOURCE_BYTES;
                event.currentTarget.setCustomValidity(
                  big ? `Files can be at most ${formatBytes(MAX_RESOURCE_BYTES)}.` : '',
                );
                setTooBig(big);
              }}
              className="text-sm file:mr-3 file:rounded-lg file:border file:bg-background file:px-3 file:py-1.5"
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              {FILE_HINT}
            </p>
            {tooBig && (
              <p role="alert" className="text-sm font-medium text-red-800">
                This file is too large: files can be at most {formatBytes(MAX_RESOURCE_BYTES)}.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Note to your teacher (optional)</Label>
            <Textarea id={noteId} name="note" maxLength={1000} rows={3} className="rounded-xl" />
          </div>
          <div>
            <SubmitButton busy={busy}>{hasDraft ? 'Replace draft' : 'Save draft'}</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface ConfirmProps {
  readonly work: StudentAssignment;
  readonly draft: SubmissionFile;
  readonly onSubmitted: (text: string) => void;
}

function ConfirmCard({ work, draft, onSubmitted }: ConfirmProps) {
  const auth = useAuth();
  const late = new Date() > new Date(work.dueAt);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`/student/assignments/${work.id}/submit`, {
      method: 'POST',
      body: { confirmFile: form.get('confirmFile') === 'on' },
    });
    onSubmitted(`${draft.fileName} submitted.`);
  });
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Review before submitting</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <FileLine file={draft} />
          {draft.note && <p className="break-words whitespace-pre-wrap">Note: {draft.note}</p>}
          {late && (
            <p className="font-medium text-red-800">
              The due date has passed: this submission will be marked late.
            </p>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmFile" required className="size-4 accent-brand" />
            This is the file I intend to submit.
          </label>
          <div>
            <SubmitButton busy={busy}>Confirm submit</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
