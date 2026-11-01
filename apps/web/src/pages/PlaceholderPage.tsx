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
      <p className="mt-1 text-sm text-muted-foreground">Current term</p>
      <div className="mt-6 rounded-2xl border-2 border-dashed border-orange-200 bg-brand-soft/50 p-8 text-sm text-muted-foreground">
        Wireframe <span className="font-mono font-semibold text-text">{screen}</span> is built in a
        later phase. See docs/BUILD_PLAN.md.
      </div>
    </section>
  );
}
