import type { ResourceDetails, ResourceVersion } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { field, FormMessage, TextField, useFormAction } from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { formatDateTime } from '../../../components/format';
import { formatBytes, OpenVersion, RAG_LABELS, ResourceStatusBadge } from '../../resources/shared';
import { nextNotice, type Notice } from '../../teacher/content/shared';

/** A11 Resource approval, version and permissions. */
export function ResourceReviewPage({ resourceId }: { resourceId: string }) {
  const result = useApiData<ResourceDetails>(`/admin/resources/${resourceId}`);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (result.status === 'loading') return <p role="status">Loading resource…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const resource = result.data;
  const base = `/admin/resources/${resourceId}`;
  const pending = resource.versions.find((version) => version.status === 'pending');
  const approved = resource.versions.find((version) => version.status === 'approved');

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => nextNotice(previous, text, tone));
    if (tone === 'success') result.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/admin/courses/resources" className="link">
          Resource library
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Resource approval, version and permissions
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {resource.title} · {resource.course.code} – {resource.course.title}
      </p>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Resource submission</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Course scope</dt>
              <dd>{resource.course.code}, enrolled course users</dd>
              <dt className="text-muted-foreground">Module</dt>
              <dd>{resource.module?.title ?? 'Whole course'}</dd>
              <dt className="text-muted-foreground">Mapped objectives</dt>
              <dd>{resource.objectives.map((objective) => objective.code).join(', ') || 'None'}</dd>
              <dt className="text-muted-foreground">Learners get</dt>
              <dd>
                {resource.approvedVersion === null
                  ? 'Nothing yet'
                  : `Version ${resource.approvedVersion}`}
              </dd>
              <dt className="text-muted-foreground">RAG status</dt>
              <dd>{RAG_LABELS[resource.ragStatus]}</dd>
            </dl>
          </CardContent>
        </Card>

        {pending ? (
          <ReviewCard
            base={base}
            version={pending}
            replaces={approved?.number ?? null}
            onChanged={announce}
          />
        ) : approved ? (
          <WithdrawCard base={base} version={approved} onChanged={announce} />
        ) : (
          <Card className="card-interactive">
            <CardContent className="text-sm text-muted-foreground">
              Nothing to review. The teacher can send a new version.
            </CardContent>
          </Card>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Versions</h2>
      <Card className="mt-3 gap-0 overflow-hidden py-0">
        <Table>
          <TableCaption className="sr-only">Versions</TableCaption>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead scope="col" className="px-4">
                Version
              </TableHead>
              <TableHead scope="col">Content</TableHead>
              <TableHead scope="col">Submitted</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="animate-fade">
            {resource.versions.map((version) => (
              <TableRow key={version.id}>
                <th scope="row" className="px-4 text-left align-middle font-medium">
                  v{version.number}
                </th>
                <TableCell className="whitespace-normal">
                  {version.kind === 'link'
                    ? version.url
                    : `${version.fileName ?? 'File'} · ${formatBytes(version.sizeBytes ?? 0)}`}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {version.submittedBy}
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(version.submittedAt)}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <ResourceStatusBadge status={version.status} />
                  {version.note && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {version.reviewedBy}: {version.note}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <OpenVersion
                    filePath={`${base}/versions/${version.id}/file`}
                    version={version}
                    onError={(message) => announce(message, 'error')}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

interface ReviewCardProps {
  readonly base: string;
  readonly version: ResourceVersion;
  readonly replaces: number | null;
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

/** Approve (both checks required) or return the version waiting for review. */
function ReviewCard({ base, version, replaces, onChanged }: ReviewCardProps) {
  const auth = useAuth();
  const noteId = useId();
  const path = `${base}/versions/${version.id}`;
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(`${path}/approve`, {
      body: {
        confirmSource: form.get('confirmSource') === 'on',
        confirmPermissions: form.get('confirmPermissions') === 'on',
        note: field(form, 'note'),
      },
    });
    onChanged(`Version ${version.number} approved.`);
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Approval and access</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <p>
            Version {version.number} is pending review
            {replaces !== null ? `; it replaces version ${replaces} once approved.` : '.'}
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Approval checks</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="confirmSource"
                required
                className="size-4 accent-brand"
              />
              Confirm source is approved
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="confirmPermissions"
                required
                className="size-4 accent-brand"
              />
              Verify permissions and metadata
            </label>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Approval note (optional)</Label>
            <Textarea id={noteId} name="note" maxLength={500} rows={2} className="rounded-xl" />
          </div>
          <div>
            <Button type="submit" aria-disabled={busy} aria-busy={busy}>
              Approve
            </Button>
          </div>
        </form>
        {/* Outside the approval form: a dialog's submit event would otherwise bubble (through
            React's tree, despite the portal) into the form above and approve as well. */}
        <div className="mt-3">
          <FormDialog
            trigger="Return for revision"
            triggerVariant="outline"
            title={`Return version ${version.number}`}
            description="The teacher sees your note and can send a corrected version."
            submitLabel="Return to teacher"
            onSubmit={async (form) => {
              await auth.request(`${path}/return`, { body: { note: field(form, 'note') } });
            }}
            afterSave={() => onChanged(`Version ${version.number} returned to the teacher.`)}
          >
            <TextField label="What should change?" name="note" required minLength={5} />
          </FormDialog>
        </div>
      </CardContent>
    </Card>
  );
}

interface WithdrawCardProps {
  readonly base: string;
  readonly version: ResourceVersion;
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

function WithdrawCard({ base, version, onChanged }: WithdrawCardProps) {
  const auth = useAuth();
  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Withdrawal / replacement</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          Version {version.number} is approved and available to enrolled learners. Withdrawn
          versions are never shown or used for answers again.
        </p>
        <div>
          <FormDialog
            trigger="Withdraw"
            triggerVariant="outline"
            title={`Withdraw version ${version.number}`}
            description="Learners lose access at once. The reason is kept in the audit log."
            submitLabel="Withdraw version"
            onSubmit={async (form) => {
              await auth.request(`${base}/versions/${version.id}/withdraw`, {
                body: { reason: field(form, 'reason') },
              });
            }}
            afterSave={() => onChanged(`Version ${version.number} withdrawn.`)}
          >
            <TextField label="Reason" name="reason" required minLength={3} />
          </FormDialog>
        </div>
      </CardContent>
    </Card>
  );
}
