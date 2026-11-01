import type { SectionDetails, SectionSummary } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { countOf, termName } from '../../components/format';
import { ClassCard, RosterTable, SeatsBar, teacherNames } from '../sections/shared';

/** T02 My Classes: the current term's classes this teacher runs. */
export function MyClassesPage() {
  const result = useApiData<SectionSummary[]>('/teacher/classes');

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        My Classes
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Your classes this term.</p>
      <div className="mt-6">
        {result.status === 'loading' && <p role="status">Loading classes…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' &&
          (result.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no classes this term. The registrar assigns teachers to sections.
            </p>
          ) : (
            <ul aria-label="Classes" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.data.map((section) => (
                <li key={section.id} className="flex">
                  <div className="flex w-full">
                    <ClassCard
                      section={section}
                      to="/teacher/classes/$sectionId"
                      students={section.enrolled}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}

/** One of the teacher's classes and its class list (read-only for teachers). */
export function ClassRosterPage({ sectionId }: { sectionId: string }) {
  const result = useApiData<SectionDetails>(`/teacher/classes/${sectionId}`);

  if (result.status === 'loading') return <p role="status">Loading class…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const section = result.data;
  const enrolled = section.roster.filter((entry) => entry.status === 'enrolled');

  return (
    <section aria-labelledby="page-title" className="max-w-4xl">
      <p className="text-sm">
        <Link to="/teacher/classes" className="link">
          My Classes
        </Link>
      </p>
      <h1 id="page-title" className="mt-2 text-2xl font-bold">
        {section.course.code} · {section.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {section.course.title} · {termName(section.term)} · {teacherNames(section)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <div className="w-full max-w-sm">
          <SeatsBar enrolled={section.enrolled} capacity={section.capacity} />
        </div>
        <Link
          to="/teacher/content/$courseId"
          params={{ courseId: section.course.id }}
          className="link text-sm"
        >
          Course content
        </Link>
      </div>
      <h2 className="mt-8 text-lg font-semibold">
        Class list · {countOf(enrolled.length, 'student')}
      </h2>
      <div className="mt-3">
        <RosterTable roster={enrolled} />
      </div>
    </section>
  );
}
