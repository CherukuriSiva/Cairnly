import { describe, expect, it } from "vitest";
import { buildSearchIndex, rankItems, scoreItem } from "@/lib/searchIndex";

describe("buildSearchIndex", () => {
  it("lists lessons, roadmaps and insights with links, meta lines and keywords", () => {
    const index = buildSearchIndex({
      lessons: [{ track: "dsa", slug: "arrays", title: "Arrays", trackTitle: "DSA", module: "Core patterns" }],
      roadmaps: [{ slug: "beginner", title: "Beginner path", timeHorizon: "6-months", tags: ["beginner"], summary: "First steps." }],
      insights: [{ slug: "glossary", title: "Glossary", category: "ai-engineering", tags: ["terms"], summary: "Words." }],
      categoryLabels: { "ai-engineering": "AI Engineering" },
    });
    expect(index).toEqual([
      { type: "lesson", title: "Arrays", href: "/dsa/arrays", meta: "DSA", keywords: "DSA Core patterns" },
      { type: "roadmap", title: "Beginner path", href: "/roadmap/beginner", meta: "6 months", keywords: "beginner First steps." },
      { type: "insight", title: "Glossary", href: "/insights/glossary", meta: "AI Engineering", keywords: "AI Engineering terms Words." },
    ]);
  });

  it("falls back to the raw category id without a label", () => {
    const [item] = buildSearchIndex({
      lessons: [],
      roadmaps: [],
      insights: [{ slug: "x", title: "X", category: "new-thing", tags: [], summary: "" }],
      categoryLabels: {},
    });
    expect(item.meta).toBe("new-thing");
  });
});

const item = (title: string, keywords = "") => ({ title, keywords });

describe("scoreItem", () => {
  it("ranks whole words in the title above word starts, keywords last", () => {
    const exact = scoreItem(item("RAG"), "rag");
    const leading = scoreItem(item("RAG Architectures"), "rag");
    const inside = scoreItem(item("Fine-Tuning vs RAG"), "rag");
    const prefix = scoreItem(item("Ragged arrays"), "rag");
    const keyword = scoreItem(item("Chunking Strategies", "AI Engineering Retrieval & RAG"), "rag");
    expect(exact).toBeGreaterThan(leading);
    expect(leading).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(0);
  });

  it("never matches scattered letters or a short query inside a word", () => {
    expect(scoreItem(item("Gradient Boosting and XGBoost"), "rag")).toBe(0);
    expect(scoreItem(item("Behavioral Interview Answers"), "rag")).toBe(0);
    expect(scoreItem(item("Salary, Equity, and Offer Negotiation"), "rag")).toBe(0);
    expect(scoreItem(item("Leverage your experience"), "rag")).toBe(0);
  });

  it("matches a longer query inside a word, and multi-word queries word by word", () => {
    expect(scoreItem(item("Blockchain basics"), "chain")).toBeGreaterThan(0);
    expect(scoreItem(item("Vector Databases Beyond FAISS"), "vector db")).toBe(0);
    expect(scoreItem(item("Vector Databases Beyond FAISS"), "vec data")).toBeGreaterThan(0);
    expect(scoreItem(item("Hybrid Search", "bm25 keyword"), "hybrid bm25")).toBeGreaterThan(0);
  });

  it("scores an empty query 0", () => {
    expect(scoreItem(item("Anything"), "  ")).toBe(0);
  });
});

describe("rankItems", () => {
  const items = [item("Gradient Boosting"), item("Chunking", "Retrieval & RAG"), item("Fine-Tuning vs RAG"), item("What is RAG")];

  it("keeps matches only, best first", () => {
    expect(rankItems(items, "rag").map((i) => i.title)).toEqual(["Fine-Tuning vs RAG", "What is RAG", "Chunking"]);
  });

  it("returns every item for an empty query", () => {
    expect(rankItems(items, "")).toBe(items);
  });
});
