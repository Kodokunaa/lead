import type { ContentStatus, CourseContent, Objective } from '@lead/schema';
import { Badge } from '@/components/ui/badge';

export type Notice = { text: string; tone: 'success' | 'error'; key: number };

/** Next notice, with a new key so FormMessage re-mounts and takes focus again. */
export function nextNotice(
  previous: Notice | null,
  text: string,
  tone: Notice['tone'] = 'success',
): Notice {
  return { text, tone, key: (previous?.key ?? 0) + 1 };
}

export function StatusBadge({ status }: { status: ContentStatus }) {
  return status === 'published' ? (
    <Badge variant="outline" className="rounded-full border-green-200 bg-green-50 text-green-800">
      Published
    </Badge>
  ) : (
    <Badge variant="secondary" className="rounded-full">
      Draft
    </Badge>
  );
}

/** "O1, O2" for a list of objective ids, in course order. */
export function objectiveCodes(content: CourseContent, ids: readonly string[]): string {
  const codes = content.objectives
    .filter((objective) => ids.includes(objective.id))
    .map((objective) => objective.code);
  return codes.length > 0 ? codes.join(', ') : 'None yet';
}

export function objectiveLabel(objective: Objective): string {
  return `${objective.code} – ${objective.description}`;
}

export function courseHeading(content: CourseContent): string {
  return `${content.course.code} – ${content.course.title}`;
}
