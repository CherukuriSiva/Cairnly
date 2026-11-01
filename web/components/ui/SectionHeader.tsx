/** A mono eyebrow, a display title (h1 or h2) and an optional muted description. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  as = "h1",
  id,
  className = "",
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  as?: "h1" | "h2";
  id?: string;
  className?: string;
  /** Extra content under the description (badges, actions). */
  children?: React.ReactNode;
}) {
  const Heading = as;
  return (
    <header className={className}>
      {eyebrow && <p className="eyebrow text-faint">{eyebrow}</p>}
      <Heading id={id} className={`${as === "h1" ? "text-display" : "text-display-2"} mt-2 text-text`}>
        {title}
      </Heading>
      {description && <p className="mt-3 max-w-[60ch] text-base text-muted">{description}</p>}
      {children}
    </header>
  );
}
