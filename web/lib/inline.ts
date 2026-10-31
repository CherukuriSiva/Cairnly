// Tokens for the chat's minimal inline markdown: **bold**, *italic* and `code`.
// Italic needs a non-space right after the opening * and right before the closing *, and no
// letter or * around them, so "*args and **kwargs" or a stray "* item *" stay plain text.

export type InlineToken = { kind: "text" | "bold" | "italic" | "code"; text: string };

const TOKEN = /(\*\*[^*\n]+\*\*|(?<![*\w])\*(?!\s)[^*\n]+?(?<!\s)\*(?![*\w])|`[^`]+`)/;

export function inlineTokens(text: string): InlineToken[] {
  // split() with a capture group puts the matched tokens at the odd indexes.
  return text
    .split(TOKEN)
    .map((part, i): InlineToken => {
      if (i % 2 === 0) return { kind: "text", text: part };
      if (part.startsWith("**")) return { kind: "bold", text: part.slice(2, -2) };
      if (part.startsWith("`")) return { kind: "code", text: part.slice(1, -1) };
      return { kind: "italic", text: part.slice(1, -1) };
    })
    .filter((token) => token.text !== "");
}
