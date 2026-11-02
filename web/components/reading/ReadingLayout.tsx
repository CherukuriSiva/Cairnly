import { ReadingProgress } from "@/components/reading/ReadingProgress";
import { Toc } from "@/components/reading/Toc";
import type { OutlineItem } from "@/lib/outline";

/**
 * The shared layout of lesson, roadmap and insight pages: an optional left navigation (lg and
 * up, with `mobileNav` shown in its place below lg), the content column (68ch), "On this page"
 * as a sticky right rail from lg (collapsible above the content below lg), and the reading
 * progress bar. At lg the side columns are narrower so the content keeps its room.
 * `aside` adds a sticky block above the outline (the roadmap's Start card).
 */
export function ReadingLayout({
  header,
  outline,
  children,
  footer,
  leftNav,
  mobileNav,
  aside,
}: {
  header: React.ReactNode;
  outline: OutlineItem[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  leftNav?: React.ReactNode;
  mobileNav?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const grid = leftNav
    ? "lg:grid-cols-[15rem_minmax(0,1fr)_12rem] xl:grid-cols-[18rem_minmax(0,1fr)_14rem]"
    : aside
      ? "lg:grid-cols-[minmax(0,1fr)_16rem]"
      : "lg:grid-cols-[minmax(0,1fr)_14rem]";
  return (
    <div className={`mx-auto grid max-w-7xl ${grid}`}>
      <ReadingProgress />
      {leftNav && (
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] border-r border-border bg-surface-1/60 lg:block">
          {leftNav}
        </aside>
      )}
      <main className="min-w-0 px-4 py-10 sm:px-8 lg:px-6 xl:px-8">
        <div className="mx-auto max-w-[68ch]">
          {mobileNav}
          {header}
          <div className="mt-8">
            <Toc items={outline} placement="inline" />
            <article className="min-w-0">{children}</article>
          </div>
          {footer}
        </div>
      </main>
      {(outline.length > 0 || aside) && (
        <div className="hidden py-10 pr-4 lg:block">
          <div className="sticky top-20 space-y-8">
            {aside}
            <Toc items={outline} placement="aside" />
          </div>
        </div>
      )}
    </div>
  );
}
