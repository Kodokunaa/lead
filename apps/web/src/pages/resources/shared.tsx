import {
  RESOURCE_STATUS_LABELS,
  type RagStatus,
  type ResourceStatus,
  type ResourceVersion,
} from '@lead/schema';
import { Download, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '../../auth/session';
import { errorMessage } from '../../components/form';
import { downloadFile } from '../../components/download';

const STATUS_STYLES: Readonly<Record<ResourceStatus, string>> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-900',
  approved: 'border-green-200 bg-green-50 text-green-800',
  returned: 'border-orange-200 bg-orange-50 text-brand-strong',
  withdrawn: 'border-red-200 bg-red-50 text-red-800',
  superseded: 'border-border bg-muted text-muted-foreground',
};

export function ResourceStatusBadge({ status }: { status: ResourceStatus }) {
  return (
    <Badge variant="outline" className={`rounded-full ${STATUS_STYLES[status]}`}>
      {RESOURCE_STATUS_LABELS[status]}
    </Badge>
  );
}

export const RAG_LABELS: Readonly<Record<RagStatus, string>> = {
  not_indexed: 'Not indexed yet',
  excluded: 'Excluded',
};

/** "2.4 MB", "830 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface OpenVersionProps {
  /** Where the file is served, e.g. `/admin/resources/<id>/versions/<id>/file`. */
  readonly filePath: string;
  readonly version: Pick<ResourceVersion, 'kind' | 'url' | 'fileName' | 'number'>;
  readonly label?: string;
  /** The full name for assistive technology, e.g. "Open Normalization guide". */
  readonly accessibleName?: string;
  readonly onError: (message: string) => void;
}

/** Opens a version: downloads its file with the session, or opens its link in a new tab. */
export function OpenVersion({
  filePath,
  version,
  label,
  accessibleName,
  onError,
}: OpenVersionProps) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const name = label ?? `Open v${version.number}`;

  if (version.kind === 'link') {
    // The API only stores http(s) links; checked again here so a bad value can never run.
    if (!version.url || !/^https?:\/\//i.test(version.url)) {
      return <span className="text-sm text-muted-foreground">No link</span>;
    }
    return (
      <a
        href={version.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={accessibleName ? `${accessibleName} (opens a new tab)` : undefined}
        className="link inline-flex items-center gap-1 text-sm"
      >
        <ExternalLink aria-hidden="true" className="size-4" /> {name}
        <span className="sr-only"> (opens a new tab)</span>
      </a>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-disabled={busy}
      aria-label={accessibleName}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        downloadFile(auth, filePath, version.fileName ?? `resource-v${version.number}`)
          .catch((caught: unknown) => onError(errorMessage(caught)))
          .finally(() => setBusy(false));
      }}
    >
      <Download aria-hidden="true" /> <span aria-live="polite">{busy ? 'Downloading…' : name}</span>
    </Button>
  );
}
