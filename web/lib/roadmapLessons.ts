// "Lessons for this stage" on each roadmap: roadmap slug → RoadmapPhase title → lessons as
// "<track>/<slug>", in reading order. Curated by hand: a lesson is listed only when it teaches
// one of the stage's bullets at a level that fits the stage (no keyword matching). A stage
// with no lesson that fits gets [] and shows none. The first lesson of the first stage is the
// roadmap's "First stone". lib/roadmapLessons.test.ts checks that every stage has an entry and
// every entry is a real lesson.

export const ROADMAP_LESSONS: Record<string, Record<string, string[]>> = {
  "ai-engineer-technical-path": {
    // Python data structures (lists, dicts, sets); no lesson covers Git, HTTP or env setup.
    "Python + Git + HTTP": ["dsa/arrays-and-frequency-maps", "dsa/hashing-and-sets"],
    "ML + LLM Foundations": [
      "ml-foundations/ml-workflow-train-test-split",
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/tokenization-and-context-windows",
      "ai-engineering/embeddings-explained",
    ],
    "RAG End-to-End": [
      "ai-engineering/build-a-rag-pipeline",
      "ai-engineering/chunking-strategies",
      "ai-engineering/vector-databases-beyond-faiss",
      "ai-engineering/hybrid-search-bm25-vector",
      "ai-engineering/reranking-with-cross-encoders",
      "ai-engineering/evaluating-an-ai-app",
    ],
    "Agents + Tools + Memory": [
      "ai-engineering/what-is-an-agent",
      "ai-engineering/the-react-loop",
      "ai-engineering/designing-a-tool-registry",
      "ai-engineering/mcp-tool-use",
      "ai-engineering/agent-memory",
      "ai-engineering/safety-guardrails",
    ],
    "Production + Portfolio": [
      "ai-systems/fastapi-architecture-for-ai",
      "ai-systems/streaming-responses-sse",
      "ai-engineering/observability",
      "ai-engineering/cost-and-latency",
      "ai-engineering/capstone-ship-rag",
      "career/three-project-portfolio",
    ],
  },
  "ai-era-beginner-readiness": {
    // First programming steps; this roadmap puts data structures and algorithms "later".
    "Months 1–2: Programming Fundamentals": [],
    "Months 3–4: Web + AI Literacy": [
      "full-stack/nextjs-app-router",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/tokenization-and-context-windows",
      "ai-engineering/embeddings-explained",
      "ai-engineering/what-is-rag",
    ],
    "Months 5–6: First Real Project": [
      "full-stack/server-actions-vs-api-routes",
      "ai-engineering/build-a-rag-pipeline",
      "full-stack/deploying-to-vercel",
    ],
  },
  "cs-student-ai-era-roadmap": {
    "Year 1: Foundations That Don't Expire": [
      "dsa/arrays-and-frequency-maps",
      "dsa/hashing-and-sets",
      "dsa/two-pointers",
      "dsa/sliding-window",
      "career/github-profile-checklist",
    ],
    "Year 2: AI + Full-Stack": [
      "ai-engineering/what-is-rag",
      "ai-engineering/embeddings-explained",
      "ai-engineering/build-a-rag-pipeline",
      "ai-engineering/prompt-engineering-patterns",
      "full-stack/nextjs-app-router",
      "full-stack/deploying-to-vercel",
    ],
    "Year 3: Specialize + Ship": [
      "ai-engineering/capstone-ship-rag",
      "full-stack/capstone-content-site",
      "career/three-project-portfolio",
      "career/ai-era-resume",
      "career/linkedin-for-engineers",
    ],
    "Final Semester: Placement Mode": [
      "dsa/talking-through-code",
      "career/behavioral-interviews",
      "career/tell-me-about-yourself",
      "career/cold-email-templates",
    ],
  },
  "final-year-placement-prep": {
    "Months 1–2: DSA Core Patterns": [
      "dsa/arrays-and-frequency-maps",
      "dsa/sliding-window",
      "dsa/two-pointers",
      "dsa/binary-search",
      "dsa/trees-dfs-bfs",
      "dsa/dp-without-fear",
    ],
    "Months 3–4: Project + System Design": [
      "career/three-project-portfolio",
      "dsa/design-lru-cache",
      "dsa/design-rate-limiter",
      "ai-engineering/what-is-rag",
      "ai-engineering/explain-rag-in-interview",
    ],
    "Month 5: Interview Mode": [
      "dsa/talking-through-code",
      "career/behavioral-interviews",
      "career/tell-me-about-yourself",
      "career/ai-era-resume",
      "career/linkedin-for-engineers",
      "career/cold-email-templates",
    ],
    "Month 6: Active Applications": ["career/job-search-routine", "dsa/pattern-recognition"],
  },
  "fullstack-dev-to-ai-engineer": {
    "Month 1: LLM API Fluency": [
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/tokenization-and-context-windows",
    ],
    "Month 2–3: RAG End-to-End": [
      "ai-engineering/what-is-rag",
      "ai-engineering/embeddings-explained",
      "ai-engineering/build-a-rag-pipeline",
      "ai-engineering/vector-databases-beyond-faiss",
      "ai-engineering/confidence-gates",
      "ai-engineering/evaluating-an-ai-app",
    ],
    "Month 4: Agents + FastAPI": [
      "ai-engineering/what-is-an-agent",
      "ai-engineering/the-react-loop",
      "ai-engineering/building-retrieval-tools-for-agents",
      "ai-systems/fastapi-architecture-for-ai",
      "ai-systems/streaming-responses-sse",
    ],
    "Month 5–6: Ship + Showcase": [
      "ai-engineering/capstone-ship-rag",
      "career/three-project-portfolio",
      "career/resume-bullets-ai-projects",
      "career/job-search-routine",
    ],
  },
  "limited-time-professional": {
    "Month 1: Understand + Build Basic": [
      "ai-engineering/what-is-rag",
      "ai-engineering/what-is-an-agent",
      "ai-engineering/tokenization-and-context-windows",
      "ai-engineering/build-a-rag-pipeline",
    ],
    "Month 2: Improve + Evaluate": [
      "ai-engineering/evaluating-an-ai-app",
      "ai-engineering/safety-guardrails",
      "ai-engineering/cost-and-latency",
      "ai-engineering/observability",
      "full-stack/deploying-to-vercel",
    ],
    "Month 3: Ship + Document": [
      "career/three-project-portfolio",
      "career/github-profile-checklist",
      "career/linkedin-for-engineers",
    ],
  },
  "non-ai-engineer-to-ai-career": {
    "Months 1–3: Foundations": [
      "ml-foundations/ml-workflow-train-test-split",
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/what-is-rag",
      "ai-engineering/embeddings-explained",
      "ai-engineering/build-a-rag-pipeline",
    ],
    "Months 4–6: Applied AI": [
      "ai-engineering/evaluating-an-ai-app",
      "ai-engineering/what-is-an-agent",
      "ai-engineering/designing-a-tool-registry",
      "ai-systems/fastapi-architecture-for-ai",
      "ai-engineering/capstone-ship-rag",
    ],
    "Months 7–8: Portfolio + Interview Prep": [
      "career/three-project-portfolio",
      "ai-engineering/explain-rag-in-interview",
      "ai-engineering/explain-an-agent-architecture",
      "ai-engineering/defend-eval-metrics",
      "career/resume-bullets-ai-projects",
    ],
    "Month 9: Job Search": ["career/job-search-routine", "career/tell-me-about-yourself"],
  },
};

/** The lessons mapped to one roadmap stage ([] when none). */
export function stageLessons(roadmap: string, stageTitle: string): string[] {
  return ROADMAP_LESSONS[roadmap]?.[stageTitle] ?? [];
}

/** The roadmap's "First stone": the first lesson of its first stage, or undefined when that
 * stage has none. */
export function firstStone(roadmap: string, stageTitles: string[]): string | undefined {
  return stageTitles.length > 0 ? stageLessons(roadmap, stageTitles[0])[0] : undefined;
}
