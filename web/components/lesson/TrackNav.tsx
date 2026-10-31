import Link from "next/link";

export interface NavTrack {
  id: string;
  title: string;
  modules: { title: string; lessons: { slug: string; title: string }[] }[];
}

const TINT = "color-mix(in srgb, var(--accent) 12%, transparent)";

/** One track's modules and lessons, with the current lesson highlighted. Used by the desktop
 * sidebar and the mobile drawer. */
export function TrackNav({ track, active }: { track: NavTrack; active: string }) {
  return (
    <nav aria-label={`${track.title} lessons`} className="space-y-5 p-4">
      <Link
        href={`/${track.id}`}
        className="block px-3 font-mono text-xs text-[var(--muted)] hover:text-[var(--ink)]"
      >
        ← {track.title}
      </Link>
      {track.modules.map((module) => (
        <div key={module.title}>
          <p className="px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {module.title}
          </p>
          <ul className="mt-1 space-y-0.5">
            {module.lessons.map((lesson) => {
              const current = lesson.slug === active;
              return (
                <li key={lesson.slug}>
                  <Link
                    href={`/${track.id}/${lesson.slug}`}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-lg px-3 py-2 text-sm ${
                      current
                        ? "font-semibold text-[var(--accent)]"
                        : "text-[var(--muted)] hover:text-[var(--ink)]"
                    }`}
                    style={current ? { background: TINT } : undefined}
                  >
                    {lesson.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
