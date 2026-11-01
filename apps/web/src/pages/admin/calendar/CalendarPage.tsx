import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_LABELS,
  MAX_GRADING_PERIODS,
  SEMESTER_LABELS,
  type CalendarEvent,
  type Offering,
  type Term,
  type TermCalendar,
} from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { countOf, formatDaySpan, termName } from '../../../components/format';

type Notice = { text: string; tone: 'success' | 'error'; key: number };

/**
 * A08 Programs, terms and academic calendar. Without a term in the address it shows the current
 * term; choosing another term moves to that term's address.
 */
export function CalendarPage({ termId }: { termId?: string }) {
  const terms = useApiData<Term[]>('/admin/terms');
  const navigate = useNavigate();
  const selectId = useId();

  const termList = terms.status === 'ready' ? terms.data : [];
  const shown = termId ?? termList.find((term) => term.current)?.id ?? termList[0]?.id;

  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="text-sm">
        <Link to="/admin/courses" className="link">
          Course Management
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        Programs, terms and academic calendar
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Institutional scope. Programs and terms are added under Course Management; dates and the
        calendar are set here.
      </p>

      <div className="mt-6 flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor={selectId}>Term</Label>
        <select
          id={selectId}
          value={shown ?? ''}
          disabled={terms.status !== 'ready'}
          onChange={(event) =>
            void navigate({
              to: '/admin/courses/calendar',
              search: { term: event.target.value },
            })
          }
          className={SELECT_CLASS}
        >
          {terms.status === 'ready' && termList.length === 0 && (
            <option value="">No terms yet</option>
          )}
          {termList.map((term) => (
            <option key={term.id} value={term.id}>
              {termName(term)}
              {term.current ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        {terms.status === 'loading' && <p role="status">Loading terms…</p>}
        {terms.status === 'error' && <FormMessage tone="error">{terms.message}</FormMessage>}
        {terms.status === 'ready' && !shown && (
          <p className="text-sm text-muted-foreground">
            No terms yet. Add one under Course Management → Terms.
          </p>
        )}
        {shown && <TermCalendarView key={shown} termId={shown} />}
      </div>
    </section>
  );
}

function TermCalendarView({ termId }: { termId: string }) {
  const result = useApiData<TermCalendar>(`/admin/terms/${termId}/calendar`);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (result.status === 'loading') return <p role="status">Loading calendar…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const calendar = result.data;
  const base = `/admin/terms/${termId}`;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => ({ text, tone, key: (previous?.key ?? 0) + 1 }));
    if (tone === 'success') result.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <FormMessage key={notice.key} tone={notice.tone}>
          {notice.text}
        </FormMessage>
      )}
      {result.refreshError && (
        <p role="alert" className="text-sm text-red-700">
          Could not refresh the calendar: {result.refreshError}
        </p>
      )}

      <div className="stagger grid gap-4 lg:grid-cols-2">
        <TermDatesCard
          // Remounts with the saved dates once they arrive.
          key={`${calendar.term.startsOn}:${calendar.term.endsOn}`}
          base={base}
          calendar={calendar}
          onSaved={() => announce('Term dates saved.')}
        />
        <GradingPeriodsCard
          // Only a change to the saved periods themselves resets the rows being edited.
          key={JSON.stringify(
            calendar.gradingPeriods.map(({ name, startsOn, endsOn }) => [name, startsOn, endsOn]),
          )}
          base={base}
          calendar={calendar}
          onSaved={() => announce('Grading periods saved.')}
        />
      </div>

      <EventsCard base={base} calendar={calendar} onChanged={announce} />
    </div>
  );
}

interface CardProps {
  readonly base: string;
  readonly calendar: TermCalendar;
  readonly onSaved: () => void;
}

function TermDatesCard({ base, calendar, onSaved }: CardProps) {
  const auth = useAuth();
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request(base, {
      method: 'PATCH',
      body: { startsOn: field(form, 'startsOn'), endsOn: field(form, 'endsOn') },
    });
    onSaved();
  });

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Academic structure</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <p className="text-sm">
            Academic year {calendar.term.schoolYear} · {SEMESTER_LABELS[calendar.term.semester]}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Start date"
              name="startsOn"
              type="date"
              defaultValue={calendar.term.startsOn}
              required
            />
            <TextField
              label="End date"
              name="endsOn"
              type="date"
              defaultValue={calendar.term.endsOn}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {calendar.offerings.length === 0
              ? 'No course offerings use this term yet.'
              : `${countOf(calendar.offerings.length, 'course offering')} ${calendar.offerings.length === 1 ? 'uses' : 'use'} this term; review them after changing its dates.`}
          </p>
          <div>
            <SubmitButton busy={busy}>Save dates</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface PeriodDraft {
  readonly key: number;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

function GradingPeriodsCard({ base, calendar, onSaved }: CardProps) {
  const auth = useAuth();
  const [periods, setPeriods] = useState<PeriodDraft[]>(() =>
    calendar.gradingPeriods.map((period, index) => ({ key: index, ...period })),
  );
  // Row keys only need to be unique; they never affect what is drawn.
  const nextKey = useRef(calendar.gradingPeriods.length);
  const addButton = useRef<HTMLButtonElement>(null);
  const { busy, error, onSubmit } = useFormAction(async () => {
    await auth.request(`${base}/grading-periods`, {
      method: 'PUT',
      body: {
        periods: periods.map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })),
      },
    });
    onSaved();
  });

  const update = (key: number, change: Partial<PeriodDraft>) =>
    setPeriods((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const remove = (key: number) => {
    setPeriods((list) => list.filter((item) => item.key !== key));
    // The clicked button is gone; keep keyboard focus in the card.
    addButton.current?.focus();
  };

  return (
    <Card className="card-interactive">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Grading periods</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {periods.length === 0 && (
            <p className="text-sm text-muted-foreground">
              None yet, e.g. Prelim, Midterm and Finals.
            </p>
          )}
          <ol aria-label="Grading periods" className="flex flex-col gap-3">
            {periods.map((period, index) => (
              <li key={period.key}>
                <fieldset className="grid grid-cols-2 items-end gap-2 rounded-xl border p-3">
                  <legend className="sr-only">Grading period {index + 1}</legend>
                  <div className="col-span-2 flex items-end gap-2">
                    <div className="flex-1">
                      <PeriodInput
                        label="Name"
                        row={index + 1}
                        value={period.name}
                        onChange={(name) => update(period.key, { name })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove grading period ${period.name || index + 1}`}
                      onClick={() => remove(period.key)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <PeriodInput
                    label="Starts"
                    row={index + 1}
                    type="date"
                    value={period.startsOn}
                    onChange={(startsOn) => update(period.key, { startsOn })}
                  />
                  <PeriodInput
                    label="Ends"
                    row={index + 1}
                    type="date"
                    value={period.endsOn}
                    onChange={(endsOn) => update(period.key, { endsOn })}
                  />
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              disabled={periods.length >= MAX_GRADING_PERIODS}
              onClick={() => {
                const key = nextKey.current;
                nextKey.current += 1;
                setPeriods((list) => [...list, { key, name: '', startsOn: '', endsOn: '' }]);
              }}
            >
              <Plus aria-hidden="true" /> Add period
            </Button>
            <SubmitButton busy={busy}>Save grading periods</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface PeriodInputProps {
  readonly label: string;
  /** Which period, so each field has its own name ("Starts, grading period 2"). */
  readonly row: number;
  readonly value: string;
  readonly type?: 'text' | 'date';
  readonly onChange: (value: string) => void;
}

function PeriodInput({ label, row, value, type = 'text', onChange }: PeriodInputProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        required
        aria-label={`${label}, grading period ${row}`}
        maxLength={type === 'text' ? 40 : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl"
      />
    </div>
  );
}

interface EventsCardProps {
  readonly base: string;
  readonly calendar: TermCalendar;
  readonly onChanged: (text: string, tone?: Notice['tone']) => void;
}

/** The calendar table: term start and end around the events, in date order. */
function EventsCard({ base, calendar, onChanged }: EventsCardProps) {
  const auth = useAuth();
  const { term } = calendar;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays aria-hidden="true" className="size-4 text-brand-strong" /> Calendar
        </h2>
        <EventDialog
          offerings={calendar.offerings}
          title="Add a calendar event"
          trigger="Add event"
          submitLabel="Add event"
          onSubmit={async (body) => {
            await auth.request(`${base}/events`, { body });
          }}
          afterSave={() => onChanged('Event added.')}
        />
      </div>
      <Table>
        <TableCaption className="sr-only">Calendar events</TableCaption>
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead scope="col" className="px-4">
              Calendar event
            </TableHead>
            <TableHead scope="col">Date / range</TableHead>
            <TableHead scope="col">Scope</TableHead>
            <TableHead scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="animate-fade">
          <TableRow>
            <th scope="row" className="px-4 text-left align-middle font-medium">
              Term start
            </th>
            <TableCell>{formatDaySpan(term.startsOn, null)}</TableCell>
            <TableCell>Whole term</TableCell>
            <TableCell>
              <span className="sr-only">No actions</span>
            </TableCell>
          </TableRow>
          {calendar.events.map((event) => (
            <TableRow key={event.id}>
              <th scope="row" className="px-4 text-left align-middle font-medium whitespace-normal">
                <div>{event.title}</div>
                <div className="text-xs text-muted-foreground">
                  {CALENDAR_EVENT_LABELS[event.kind]}
                </div>
              </th>
              <TableCell>{formatDaySpan(event.startsOn, event.endsOn)}</TableCell>
              <TableCell className="whitespace-normal">{scopeOf(event)}</TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <EventDialog
                  offerings={calendar.offerings}
                  event={event}
                  title={`Edit ${event.title}`}
                  trigger="Edit"
                  triggerLabel={`Edit ${event.title}`}
                  submitLabel="Save"
                  onSubmit={async (body) => {
                    await auth.request(`${base}/events/${event.id}`, { method: 'PUT', body });
                  }}
                  afterSave={() => onChanged(`${event.title} updated.`)}
                />
                <FormDialog
                  trigger="Remove"
                  triggerVariant="ghost"
                  triggerLabel={`Remove ${event.title}`}
                  title={`Remove ${event.title}?`}
                  description="It disappears from every class calendar this term."
                  submitLabel="Remove event"
                  onSubmit={async () => {
                    await auth.request(`${base}/events/${event.id}/remove`, { method: 'POST' });
                  }}
                  afterSave={() => onChanged(`${event.title} removed.`)}
                />
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <th scope="row" className="px-4 text-left align-middle font-medium">
              Term end
            </th>
            <TableCell>{formatDaySpan(term.endsOn, null)}</TableCell>
            <TableCell>Whole term</TableCell>
            <TableCell>
              <span className="sr-only">No actions</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="p-4 text-xs text-muted-foreground">
        Events must fall within the term. Term dates cannot move past an event or grading period;
        move those first.
      </p>
    </Card>
  );
}

function scopeOf(event: CalendarEvent): string {
  return event.courses.length === 0
    ? 'All courses'
    : event.courses.map((course) => course.code).join(', ');
}

interface EventDialogProps {
  readonly offerings: readonly Offering[];
  readonly event?: CalendarEvent;
  readonly title: string;
  readonly trigger: string;
  readonly triggerLabel?: string;
  readonly submitLabel: string;
  readonly onSubmit: (body: Record<string, unknown>) => Promise<void>;
  readonly afterSave: () => void;
}

function EventDialog({
  offerings,
  event,
  title,
  trigger,
  triggerLabel,
  submitLabel,
  onSubmit,
  afterSave,
}: EventDialogProps) {
  const kindId = useId();
  const chosen = new Set(event?.courses.map((course) => course.id) ?? []);
  return (
    <FormDialog
      trigger={
        event ? (
          trigger
        ) : (
          <>
            <Plus aria-hidden="true" /> {trigger}
          </>
        )
      }
      triggerVariant={event ? 'ghost' : 'default'}
      triggerLabel={triggerLabel}
      title={title}
      description="Leave every course unticked for an event that applies to the whole term."
      submitLabel={submitLabel}
      onSubmit={async (form) => {
        await onSubmit({
          title: field(form, 'title'),
          kind: field(form, 'kind'),
          startsOn: field(form, 'startsOn'),
          endsOn: field(form, 'endsOn'),
          courseIds: form.getAll('courseIds').filter((value) => typeof value === 'string'),
        });
      }}
      afterSave={afterSave}
    >
      <TextField label="Title" name="title" defaultValue={event?.title} required maxLength={120} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={kindId}>Kind</Label>
        <select
          id={kindId}
          name="kind"
          defaultValue={event?.kind ?? 'assessment_period'}
          className={SELECT_CLASS}
        >
          {CALENDAR_EVENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CALENDAR_EVENT_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Starts"
          name="startsOn"
          type="date"
          defaultValue={event?.startsOn}
          required
        />
        <TextField
          label="Ends (optional)"
          name="endsOn"
          type="date"
          defaultValue={event?.endsOn ?? ''}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Scope</legend>
        {offerings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No course has a section this term, so the event applies to the whole term.
          </p>
        ) : (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {offerings.map((offering) => (
              <label key={offering.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="courseIds"
                  value={offering.id}
                  defaultChecked={chosen.has(offering.id)}
                  className="size-4 accent-brand"
                />
                {offering.code} – {offering.title}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </FormDialog>
  );
}
