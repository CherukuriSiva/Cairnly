// The product name as readers see it. Every user-visible string uses SITE_NAME; technical
// identifiers (domains, package and env names, storage keys, the `cairnly` CLI) stay lowercase.

export const SITE_NAME = "Cairnly";
export const SITE_DESCRIPTION = "AI engineering lessons for new graduates, with a chat that cites them.";

/** "<page> · Cairnly", the <title> of every page but the home page. */
export function pageTitle(title: string): string {
  return `${title} · ${SITE_NAME}`;
}
