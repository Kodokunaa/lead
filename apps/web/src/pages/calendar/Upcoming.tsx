import { CALENDAR_EVENT_LABELS, type ClassCalendar } from '@lead/schema';
import { formatDaySpan } from '../../components/format';

const UPCOMING_LIMIT = 5;

/** The grading period under way and the next events of a class (T03 and S03). */
export function Upcoming({ calendar, today }: { calendar: ClassCalendar; today: string }) {
  const period = calendar.gradingPeriods.find(
    (item) => item.startsOn <= today && today <= item.endsOn,
  );
  const upcoming = calendar.events
    .filter((event) => (event.endsOn ?? event.startsOn) >= today)
    .slice(0, UPCOMING_LIMIT);

  return (
    <div className="flex flex-col gap-3">
      {period && (
        <p>
          Grading period: <span className="font-medium">{period.name}</span> (
          {formatDaySpan(period.startsOn, period.endsOn)})
        </p>
      )}
      {upcoming.length === 0 ? (
        <p className="text-muted-foreground">Nothing else scheduled this term.</p>
      ) : (
        <ul aria-label="Upcoming events" className="divide-y divide-border">
          {upcoming.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-x-3 py-2">
              <span>
                <span className="font-medium">{event.title}</span>{' '}
                <span className="text-muted-foreground">
                  · {CALENDAR_EVENT_LABELS[event.kind]}
                  {event.courses.length > 0 ? '' : ' · whole term'}
                </span>
              </span>
              <span className="text-muted-foreground">
                {formatDaySpan(event.startsOn, event.endsOn)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Term ends {formatDaySpan(calendar.term.endsOn, null)}.
      </p>
    </div>
  );
}
