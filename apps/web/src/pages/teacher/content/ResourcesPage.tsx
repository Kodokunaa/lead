import {
  MAX_RESOURCE_BYTES,
  RESOURCE_FILE_TYPES,
  type CourseContent,
  type ResourceSummary,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  field,
  FormMessage,
  SELECT_CLASS,
  SubmitButton,
  TextField,
  useFormAction,
} from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { formatBytes, OpenVersion, ResourceStatusBadge } from '../../resources/shared';
import { courseHeading, nextNotice, objectiveLabel, type Notice } from './shared';

const ACCEPT = Object.keys(RESOURCE_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');
const FILE_HINT = `PDF, PNG or JPEG, Word, PowerPoint, Excel or text; up to ${formatBytes(MAX_RESOURCE_BYTES)}.`;

/** T07 Course resource upload and access. */
export function ResourcesPage({ courseId }: { courseId: string }) {
  const content = useApiData<CourseContent>(`/teacher/content/${courseId}`);
  const list = useApiData<ResourceSummary[]>(`/teacher/content/${courseId}/resources`);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Bumped after a submission so the upload form starts empty again.
  const [formVersion, setFormVersion] = useState(0);

  if (content.status === 'loading') return <p role="status">Loading resources…</p>;
  if (content.status === 'error') return <FormMessage tone="error">{content.message}</FormMessage>;
  const base = `/teacher/content/${courseId}/resources`;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') list.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/teacher/content/$courseId" params={{ courseId }} className="link">
          Course outline
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Course resource upload and access
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Current term · {courseHeading(content.data)}
      </p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}

      <div className="mt-6">
        <UploadCard
          key={formVersion}
          base={base}
          content={content.data}
          onSubmitted={(title) => {
            setFormVersion((value) => value + 1);
            announce(`${title} was sent for approval.`);
          }}
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Resources</h2>
      <div className="mt-3">
        {list.status === 'loading' && <p role="status">Loading resources…</p>}
        {list.status === 'error' && <FormMessage tone="error">{list.message}</FormMessage>}
        {list.status === 'ready' &&
          (list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources yet.</p>
          ) : (
            <ResourceTable base={base} resources={list.data} onChanged={announce} />
          ))}
      </div>
    </section>
  );
}

interface UploadCardProps {
  readonly base: string;
  readonly content: CourseContent;
  readonly onSubmitted: (title: string) => void;
}

function UploadCard({ base, content, onSubmitted }: UploadCardProps) {
  const auth = useAuth();
  const moduleId = useId();
  const [source, setSource] = useState<'file' | 'link'>('file');
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(base, { body: form });
    onSubmitted(field(form, 'title') || 'The resource');
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Upload a resource</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <TextField label="Resource title" name="title" required maxLength={160} />
          <SourceFields source={source} onSource={setSource} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={moduleId}>Module</Label>
              <select id={moduleId} name="moduleId" defaultValue="" className={SELECT_CLASS}>
                <option value="">Whole course</option>
                {content.modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.position} / {module.title}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">Learning objectives</legend>
              {content.objectives.length === 0 ? (
                <p className="text-sm text-muted-foreground">None in this course yet.</p>
              ) : (
                content.objectives.map((objective) => (
                  <label key={objective.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="objectiveIds"
                      value={objective.id}
                      className="mt-1 size-4 accent-brand"
                    />
                    {objectiveLabel(objective)}
                  </label>
                ))
              )}
            </fieldset>
          </div>
          <p className="text-xs text-muted-foreground">
            Students and the AI tools do not see it until an administrator approves it.
          </p>
          <div>
            <SubmitButton busy={busy}>Submit for approval</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface SourceFieldsProps {
  readonly source: 'file' | 'link';
  readonly onSource: (source: 'file' | 'link') => void;
}

/** File or link: only the chosen field is in the form, so only it is sent. */
function SourceFields({ source, onSource }: SourceFieldsProps) {
  const fileId = useId();
  const hintId = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Source</legend>
      <div className="flex gap-4 text-sm">
        {(['file', 'link'] as const).map((choice) => (
          <label key={choice} className="flex items-center gap-2">
            <input
              type="radio"
              name="source"
              value={choice}
              checked={source === choice}
              onChange={() => onSource(choice)}
              className="size-4 accent-brand"
            />
            {choice === 'file' ? 'Upload a file' : 'Approved link'}
          </label>
        ))}
      </div>
      {source === 'file' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={fileId}>File</Label>
          <Input
            id={fileId}
            name="file"
            type="file"
            accept={ACCEPT}
            required
            aria-describedby={hintId}
            // Too-large files are stopped here, before the whole file is sent.
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.setCustomValidity(
                chosen && chosen.size > MAX_RESOURCE_BYTES
                  ? `Files can be at most ${formatBytes(MAX_RESOURCE_BYTES)}.`
                  : '',
              );
            }}
            className="h-11 rounded-xl"
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {FILE_HINT}
          </p>
        </div>
      ) : (
        <TextField
          label="Link"
          name="url"
          type="url"
          placeholder="https://"
          required
          maxLength={2000}
        />
      )}
    </fieldset>
  );
}

interface ResourceTableProps {
  readonly base: string;
  readonly resources: readonly ResourceSummary[];
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

function ResourceTable({ base, resources, onChanged }: ResourceTableProps) {
  const auth = useAuth();
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableCaption className="sr-only">Resources</TableCaption>
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead scope="col" className="px-4">
              Resource
            </TableHead>
            <TableHead scope="col">Objectives</TableHead>
            <TableHead scope="col">Version</TableHead>
            <TableHead scope="col">Approval</TableHead>
            <TableHead scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="animate-fade">
          {resources.map((resource) => (
            <TableRow key={resource.id}>
              <th scope="row" className="px-4 text-left align-middle font-normal whitespace-normal">
                <div className="font-medium">{resource.title}</div>
                <div className="text-xs text-muted-foreground">
                  {resource.module?.title ?? 'Whole course'}
                </div>
                {resource.latest.status === 'returned' && resource.latest.note && (
                  <div className="mt-1 text-xs text-brand-strong">
                    Reviewer: {resource.latest.note}
                  </div>
                )}
              </th>
              <TableCell>
                {resource.objectives.map((objective) => objective.code).join(', ') || '—'}
              </TableCell>
              <TableCell className="whitespace-normal">
                v{resource.latest.number}
                {resource.approvedVersion !== null &&
                  resource.approvedVersion !== resource.latest.number && (
                    <div className="text-xs text-muted-foreground">
                      Students get v{resource.approvedVersion}
                    </div>
                  )}
              </TableCell>
              <TableCell>
                <ResourceStatusBadge status={resource.latest.status} />
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <OpenVersion
                  filePath={`${base}/${resource.id}/versions/${resource.latest.id}/file`}
                  version={resource.latest}
                  label="Open"
                  accessibleName={`Open ${resource.title}`}
                  onError={(message) => onChanged(message, 'error')}
                />
                <NewVersionDialog
                  title={resource.title}
                  disabled={resource.latest.status === 'pending'}
                  onSubmit={async (form) => {
                    await auth.request(`${base}/${resource.id}/versions`, { body: form });
                  }}
                  afterSave={() => onChanged(`A new version of ${resource.title} was sent.`)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

interface NewVersionDialogProps {
  readonly title: string;
  readonly disabled: boolean;
  readonly onSubmit: (form: FormData) => Promise<void>;
  readonly afterSave: () => void;
}

function NewVersionDialog({ title, disabled, onSubmit, afterSave }: NewVersionDialogProps) {
  const [source, setSource] = useState<'file' | 'link'>('file');
  return (
    <FormDialog
      trigger="New version"
      triggerVariant="ghost"
      triggerLabel={`New version of ${title}`}
      disabled={disabled}
      title={`New version of ${title}`}
      description="It waits for approval; students keep the approved version until then."
      submitLabel="Submit for approval"
      onSubmit={onSubmit}
      afterSave={afterSave}
    >
      <SourceFields source={source} onSource={setSource} />
    </FormDialog>
  );
}
