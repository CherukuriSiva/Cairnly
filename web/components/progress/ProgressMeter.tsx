/** "N / M done" with a thin accent bar. */
export function ProgressMeter({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={className}>
      <p className="font-mono text-xs text-faint">
        {done} / {total} done
      </p>
      <div
        role="progressbar"
        aria-label="Lessons done"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
