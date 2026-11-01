// The header's sections and which one a path belongs to.

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/syllabus", label: "Learn" },
  { href: "/roadmap", label: "Roadmaps" },
  { href: "/insights", label: "Insights" },
  { href: "/news", label: "News" },
];

/**
 * The nav link a path belongs to, or undefined (home, /ask, a 404). Learn covers /syllabus and
 * every track and lesson page (`/<track id>` and `/<track id>/<lesson>`); the others own their
 * path and everything under it.
 */
export function activeHref(pathname: string, trackIds: readonly string[]): string | undefined {
  const first = pathname.split("/")[1] ?? "";
  if (pathname === "/syllabus" || trackIds.includes(first)) return "/syllabus";
  return NAV_LINKS.find(
    (link) => link.href !== "/syllabus" && (pathname === link.href || pathname.startsWith(`${link.href}/`)),
  )?.href;
}
