import { describe, expect, it } from "vitest";
import { filterInsights, relatedInsights } from "@/lib/insights";

const insight = (slug: string, category: string, title = slug, summary = "") => ({ slug, category, title, summary });

const all = [
  insight("rag", "ai-engineering", "RAG architectures", "retrieval patterns"),
  insight("agents", "ai-engineering", "From LLM to agent", "tools and loops"),
  insight("mlops", "ai-systems", "MLOps basics", "drift and RAG serving"),
  insight("resume", "career", "AI-era resume"),
  insight("evals", "ai-engineering", "Evals"),
  insight("guard", "ai-engineering", "Guardrails"),
];

describe("filterInsights", () => {
  it("filters by category and by a query over title and summary", () => {
    expect(filterInsights(all, "", "").map((i) => i.slug)).toHaveLength(6);
    expect(filterInsights(all, "career", "").map((i) => i.slug)).toEqual(["resume"]);
    expect(filterInsights(all, "", "  rag ").map((i) => i.slug)).toEqual(["rag", "mlops"]);
    expect(filterInsights(all, "ai-systems", "rag").map((i) => i.slug)).toEqual(["mlops"]);
    expect(filterInsights(all, "career", "rag")).toEqual([]);
  });
});

describe("relatedInsights", () => {
  it("takes up to three others from the same category", () => {
    expect(relatedInsights(all, all[0]).map((i) => i.slug)).toEqual(["agents", "evals", "guard"]);
    expect(relatedInsights(all, all[3])).toEqual([]);
  });
});
