/** Layout for roadmap and insight pages: a label, the title, the summary and the MDX body. */
export function Article({
  label,
  title,
  summary,
  children,
}: {
  label: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <article>
        <p className="font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          {label}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        {summary && (
          <p className="mt-3 text-lg" style={{ color: "var(--muted)" }}>
            {summary}
          </p>
        )}
        <div className="mt-8">{children}</div>
      </article>
    </main>
  );
}
