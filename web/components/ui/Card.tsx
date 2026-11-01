import Link from "next/link";

const SURFACE = "block rounded-2xl border border-border bg-surface-1";

/** Hover lift, accent border and glow; no lift under reduced motion. */
export const INTERACTIVE =
  "transition-[transform,border-color,box-shadow] duration-150 motion-safe:hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] hover:shadow-[0_0_0_1px_var(--accent-glow),0_12px_32px_-16px_var(--accent-glow)]";

/** A surface card. With `href` the whole card is one link (internal, or external in a new tab). */
export function Card({
  href,
  external = false,
  className = "",
  children,
  ...rest
}: {
  href?: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  if (!href) {
    return (
      <div className={`${SURFACE} ${className}`} {...rest}>
        {children}
      </div>
    );
  }
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${SURFACE} ${INTERACTIVE} ${className}`} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${SURFACE} ${INTERACTIVE} ${className}`} {...rest}>
      {children}
    </Link>
  );
}
