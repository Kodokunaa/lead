import type { RosterEntry, SectionSummary } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { BookOpen, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { countOf, formatDateTime, termName } from '../../components/format';

/** "28 / 40" with a bar; turns amber when nearly full and red when full. */
interface SeatsBarProps {
  readonly enrolled: number;
  readonly capacity: number;
  /** Names the meter when several are on screen, e.g. "Seats taken, IS 301 BSIS 3-A". */
  readonly label?: string;
}

export function SeatsBar({ enrolled, capacity, label = 'Seats taken' }: SeatsBarProps) {
  const ratio = capacity > 0 ? Math.min(1, enrolled / capacity) : 0;
  const tone = ratio >= 1 ? 'bg-red-600' : ratio >= 0.9 ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={enrolled}
        aria-valuetext={`${enrolled} of ${capacity} seats taken`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${tone}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <span className="text-xs whitespace-nowrap tabular-nums">
        {enrolled} / {capacity}
      </span>
    </div>
  );
}

export function teacherNames(section: Pick<SectionSummary, 'teachers'>): string {
  return section.teachers.length > 0
    ? section.teachers.map((teacher) => teacher.displayName).join(', ')
    : 'No teacher yet';
}

interface RosterTableProps {
  readonly roster: RosterEntry[];
  /** Per-row actions (e.g. Drop for administrators); none for a read-only roster. */
  readonly actions?: (entry: RosterEntry) => ReactNode;
}

/** Students of a section: enrolled first, then dropped (kept for the record). */
export function RosterTable({ roster, actions }: RosterTableProps) {
  if (roster.length === 0) {
    return <p className="text-sm text-muted-foreground">No students enrolled yet.</p>;
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableCaption className="sr-only">Students</TableCaption>
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead scope="col" className="px-4">
              Student
            </TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              Since
            </TableHead>
            {actions && (
              <TableHead scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody className="animate-fade">
          {roster.map((entry) => (
            <TableRow key={entry.id} className="transition-colors hover:bg-accent/60">
              <TableCell className="px-4 whitespace-normal">
                <div className="font-medium">{entry.displayName}</div>
                <div className="text-xs text-muted-foreground">{entry.email}</div>
              </TableCell>
              <TableCell>
                {entry.status === 'enrolled' ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-green-200 bg-green-50 text-green-800"
                  >
                    Enrolled
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="rounded-full">
                    Dropped
                  </Badge>
                )}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {formatDateTime(
                  entry.status === 'dropped' && entry.droppedAt
                    ? entry.droppedAt
                    : entry.enrolledAt,
                )}
              </TableCell>
              {actions && <TableCell className="text-right">{actions(entry)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

interface ClassCardProps {
  readonly section: Pick<SectionSummary, 'id' | 'name' | 'course' | 'term' | 'teachers'>;
  /** Where the card leads, if anywhere. */
  readonly to?: '/teacher/classes/$sectionId' | '/student/courses/$sectionId';
  readonly students?: number;
  /** h3 when the cards sit under a section heading of their own (e.g. a term). */
  readonly headingLevel?: 'h2' | 'h3';
}

/** A class as a card, like the "My Courses" cards on the dashboard wireframe. */
export function ClassCard({ section, to, students, headingLevel = 'h2' }: ClassCardProps) {
  const Heading = headingLevel;
  const body = (
    <>
      <div className="relative flex h-24 items-end overflow-hidden rounded-t-[inherit] bg-gradient-to-br from-orange-400 via-brand to-amber-300 p-4">
        <BookOpen aria-hidden="true" className="absolute top-3 right-3 size-10 text-white/40" />
        <span className="rounded-lg bg-white/90 px-2 py-0.5 text-sm font-bold text-brand-text">
          {section.course.code}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <Heading className="leading-snug font-semibold">{section.course.title}</Heading>
        <p className="text-sm text-muted-foreground">
          {section.name} · {termName(section.term)}
        </p>
        <p className="mt-auto pt-2 text-sm">{teacherNames(section)}</p>
        {students !== undefined && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users aria-hidden="true" className="size-4" /> {countOf(students, 'student')}
          </p>
        )}
      </div>
    </>
  );
  const className = 'card-interactive flex flex-col gap-0 overflow-hidden py-0';
  if (to) {
    return (
      <Card className={className}>
        <Link
          to={to}
          params={{ sectionId: section.id }}
          className="flex flex-1 flex-col rounded-[inherit] outline-offset-4"
          aria-label={`${section.course.code} ${section.course.title}, ${section.name}`}
        >
          {body}
        </Link>
      </Card>
    );
  }
  return <Card className={className}>{body}</Card>;
}
