interface PlaceholderPageProps {
  readonly title: string;
  readonly screen: string;
}

/** Stand-in for screens built in later phases; shows the wireframe ID it will implement. */
export function PlaceholderPage({ title, screen }: PlaceholderPageProps) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted">Current term</p>
      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-muted">
        Wireframe <span className="font-mono font-semibold text-text">{screen}</span> is built in a
        later phase. See docs/BUILD_PLAN.md.
      </div>
    </section>
  );
}
