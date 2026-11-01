import { describe, expect, it } from "vitest";
import { askHref, STARTERS } from "@/lib/starters";

describe("askHref", () => {
  it("links the chat at /ask with the question encoded", () => {
    expect(askHref("What is RAG?")).toBe("/ask?q=What%20is%20RAG%3F");
  });

  it("adds the track scope when given", () => {
    expect(askHref('Explain "Arrays"', "dsa")).toBe("/ask?q=Explain%20%22Arrays%22&track=dsa");
  });

  it("has six starter questions", () => {
    expect(STARTERS).toHaveLength(6);
  });
});
