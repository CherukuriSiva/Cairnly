import { describe, expect, it } from "vitest";
import { plainText } from "@/lib/chat/plain";

describe("plainText", () => {
  it("drops markdown marks, list bullets and citation markers", () => {
    expect(plainText("## Idea\n\n**RAG** retrieves *then* generates [1][2].\n\n- one\n- two [3]")).toBe("Idea RAG retrieves then generates. one two");
  });

  it("keeps snake_case words and replaces code blocks", () => {
    expect(plainText("Set `top_k`:\n```py\nk = 6\n```\nDone.")).toBe("Set top_k: (code example) Done.");
  });

  it("cuts long text at a word boundary", () => {
    const out = plainText("word ".repeat(300), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("word…")).toBe(true);
  });
});
