import { describe, expect, it } from "vitest";
import { isAiTitle } from "./filter";

describe("isAiTitle", () => {
  it.each([
    "Malware uses LLMs to rank stolen files",
    "Show HN: A dashboard for your agent runs",
    "GPT-5.6 is out",
    "Fine-tuning small models on a laptop",
    "Fine-tuning vs RAG: what to pick",
    "RAG is not dead",
    "AI-powered code review in practice",
    "Gemini 3 pricing announced",
    "A new open weights model beats the benchmarks",
    "How language models count",
    "The MCP server that checks your evals",
    "Hugging Face ships a new library",
    "Prompts are code, so test them",
  ])("keeps %s", (title) => {
    expect(isAiTitle(title)).toBe(true);
  });

  it.each([
    "Karl Bushby is almost home",
    "Wall Street closes higher",
    "Fiber lasts decades under the sea",
    "Cloud storage prices fall",
    "He said the ferragosto sale was over",
    "Maine Coon cats and their models of behaviour",
    "A fashion model on the runway",
    "Please paint the wall again",
  ])("drops %s", (title) => {
    expect(isAiTitle(title)).toBe(false);
  });

  it("does not match keywords inside longer words", () => {
    expect(isAiTitle("said")).toBe(false);
    expect(isAiTitle("storage")).toBe(false);
    expect(isAiTitle("Bushby")).toBe(false);
    expect(isAiTitle("agentless installs")).toBe(false);
  });
});
