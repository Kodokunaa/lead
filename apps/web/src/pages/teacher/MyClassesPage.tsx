import type { SectionSummary } from '@lead/schema';
import { useApiData } from '../../auth/use-api';
import { FormMessage } from '../../components/form';
import { ClassCard } from '../sections/shared';

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
