import type { StudentClass } from '@lead/schema';
import { useApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { termName } from '../../components/format';
import { ClassCard } from '../sections/shared';

/** S02 My Courses: the student's enrolled classes, grouped by term (newest first). */
export function MyCoursesPage() {
  const result = useApiData<StudentClass[]>('/student/classes');

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        My Courses
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">The classes you are enrolled in.</p>
      <div className="mt-6 flex flex-col gap-8">
        {result.status === 'loading' && <p role="status">Loading courses…</p>}
        {result.status === 'error' && <FormMessage tone="error">{result.message}</FormMessage>}
        {result.status === 'ready' &&
          (result.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You are not enrolled in any class yet. The registrar enrolls you each term.
            </p>
          ) : (
            byTerm(result.data).map(({ id, label, current, classes }) => (
              <section key={id} aria-labelledby={`term-${id}`}>
                <h2 id={`term-${id}`} className="font-semibold">
                  {label}
                  {current && (
                    <span className="ml-2 text-sm font-normal text-brand-strong">current term</span>
                  )}
                </h2>
                <ul className="stagger mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {classes.map((section) => (
                    <li key={section.id} className="flex">
                      <div className="flex w-full">
                        <ClassCard
                          section={section}
                          to="/student/courses/$sectionId"
                          headingLevel="h3"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ))}
      </div>
    </section>
  );
}

interface TermGroup {
  readonly id: string;
  readonly label: string;
  readonly current: boolean;
  readonly classes: StudentClass[];
}

/** Current term first, then the rest by school year and semester, newest first. */
function byTerm(classes: StudentClass[]): TermGroup[] {
  const order = { first: 0, second: 1, summer: 2 } as const;
  const newerFirst = (a: StudentClass['term'], b: StudentClass['term']): number => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.schoolYear !== b.schoolYear) return a.schoolYear < b.schoolYear ? 1 : -1;
    return order[b.semester] - order[a.semester];
  };
  const byCode = (a: StudentClass, b: StudentClass): number =>
    a.course.code < b.course.code ? -1 : a.course.code > b.course.code ? 1 : 0;
  const terms = [...new Map(classes.map((section) => [section.term.id, section.term])).values()];
  return terms.sort(newerFirst).map((term) => ({
    id: term.id,
    label: termName(term),
    current: term.current,
    classes: classes.filter((section) => section.term.id === term.id).sort(byCode),
  }));
}
