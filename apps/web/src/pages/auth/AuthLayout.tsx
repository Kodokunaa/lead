import type { ReactNode } from 'react';

interface AuthLayoutProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

/** Shared frame for the signed-out screens (H01–H05): college intro beside the form card. */
export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <div className="grid w-full max-w-4xl gap-10 md:grid-cols-2 md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-bold"
            >
              CCC
            </span>
            <div className="leading-tight">
              <p className="font-semibold">Project LEAD</p>
              <p className="text-sm text-muted">City College of Calapan</p>
            </div>
          </div>
          <p className="mt-8 text-2xl leading-snug font-semibold">
            Learning Enhancement through Artificial Intelligence and Digital Analytics
          </p>
          <p className="mt-4 text-muted">
            Secure access to your courses, learning support and academic records.
          </p>
        </div>

        <section
          aria-labelledby="auth-title"
          className="rounded-lg border border-border bg-surface p-6"
        >
          <h1 id="auth-title" className="text-xl font-semibold">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
