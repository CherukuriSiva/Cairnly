// An answer as plain text, for the screen-reader announcement: markdown marks, code fences and
// [n] citation markers removed, white space collapsed, cut at a word boundary.

export const ANNOUNCE_MAX_CHARS = 600;

export function plainText(markdown: string, max = ANNOUNCE_MAX_CHARS): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " (code example) ")
    .replace(/\s*\[\d+\]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(\S[^*]*?)\*/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
