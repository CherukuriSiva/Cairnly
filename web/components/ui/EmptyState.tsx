import { Inbox, type LucideIcon } from "lucide-react";

/** Shown when a list or a search has nothing to show: icon, title, text, optional action. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  text,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
      <Icon size={24} aria-hidden="true" className="text-faint" />
      <p className="mt-3 font-semibold text-text">{title}</p>
      {text && <p className="mt-1 max-w-[48ch] text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A pulsing placeholder block (static under reduced motion). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`motion-safe:animate-pulse rounded-md bg-surface-3 ${className}`} />;
}
