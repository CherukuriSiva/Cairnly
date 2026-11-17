import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { CATEGORY_LABELS, getRoadmaps } from "@/lib/content";
import { SITE_NAME } from "@/lib/site";
import { getTracks } from "@/lib/syllabus";

const REPO_URL = "https://github.com/CherukuriSiva/Cairnly";

/** The GitHub mark (lucide no longer ships brand icons). */
function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="eyebrow text-faint">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-muted hover:text-text">
        {children}
      </Link>
    </li>
  );
}

/** The site footer: tagline, links to every track, roadmap and insight category, a More column
 * (News, the chat, the GitHub repository) and the source credits. */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-surface-1/60">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4">
            <Logo />
            <p className="mt-3 max-w-[32ch] text-sm text-muted">Stones on the trail into AI engineering.</p>
          </div>
          <Column title="Learn">
            <FooterLink href="/syllabus">Syllabus</FooterLink>
            {getTracks().map((track) => (
              <FooterLink key={track.id} href={`/${track.id}`}>
                {track.title}
              </FooterLink>
            ))}
          </Column>
          <Column title="Roadmaps">
            {getRoadmaps().map((roadmap) => (
              <FooterLink key={roadmap.slug} href={`/roadmap/${roadmap.slug}`}>
                {roadmap.title}
              </FooterLink>
            ))}
          </Column>
          <Column title="Insights">
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
              <FooterLink key={id} href={`/insights?category=${id}`}>
                {label}
              </FooterLink>
            ))}
          </Column>
          <Column title="More">
            <FooterLink href="/news">News</FooterLink>
            <FooterLink href="/ask">Ask {SITE_NAME}</FooterLink>
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-muted hover:text-text">
                <GitHubIcon />
                GitHub
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          </Column>
        </div>
        <div className="mt-10 border-t border-border pt-6 text-xs text-faint">
          <p className="max-w-[70ch]">
            Links on the News page open their source; Hacker News stories open the discussion. Thank you to arXiv for use of its open access
            interoperability.
          </p>
        </div>
      </div>
    </footer>
  );
}
