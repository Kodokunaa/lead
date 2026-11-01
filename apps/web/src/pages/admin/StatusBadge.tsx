import type { AccountStatus } from '@lead/schema';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';

export const STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  pending: 'Pending',
  active: 'Active',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};

/** Soft colors with dark text, all above 4.5:1 contrast. */
const STATUS_STYLES: Readonly<Record<AccountStatus, string>> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  active: 'border-green-200 bg-green-50 text-green-800',
  deactivated: 'border-stone-200 bg-stone-100 text-stone-700',
  rejected: 'border-red-200 bg-red-50 text-red-800',
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  return (
    <Badge variant="outline" className={cn('rounded-full', STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
