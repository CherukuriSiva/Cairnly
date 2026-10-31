import { describe, expect, it } from "vitest";

import { inlineTokens } from "./inline";

describe("inlineTokens", () => {
  it("finds bold, italic and code", () => {
    expect(inlineTokens("Use **RAG** to *retrieve* with `search()`.")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "bold", text: "RAG" },
      { kind: "text", text: " to " },
      { kind: "italic", text: "retrieve" },
      { kind: "text", text: " with " },
      { kind: "code", text: "search()" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves Python-style *args and **kwargs as plain text", () => {
    expect(inlineTokens("Use *args and **kwargs")).toEqual([
      { kind: "text", text: "Use *args and **kwargs" },
    ]);
  });

  it("leaves stray asterisks with spaces as plain text", () => {
    expect(inlineTokens("* item one *")).toEqual([{ kind: "text", text: "* item one *" }]);
    expect(inlineTokens("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });
});
