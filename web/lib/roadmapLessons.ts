// "Lessons for this stage" on each roadmap: roadmap slug → RoadmapPhase title → lessons as
// "<track>/<slug>", in reading order. Chosen by hand from each stage's bullets and the lesson
// titles (relevant lessons only, 1 to 5 per stage). lib/roadmapLessons.test.ts checks that every
// stage has an entry and every entry is a real lesson.

export const ROADMAP_LESSONS: Record<string, Record<string, string[]>> = {
  "ai-engineer-technical-path": {
    "Python + Git + HTTP": [
      "ai-systems/designing-ai-api-contracts",
      "full-stack/server-actions-vs-api-routes",
      "career/github-profile-checklist",
      "full-stack/deploying-to-vercel",
    ],
    "ML + LLM Foundations": [
      "ml-foundations/ml-workflow-train-test-split",
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/tokenization-and-context-windows",
      "ai-engineering/embeddings-explained",
    ],
    "RAG End-to-End": [
      "ai-engineering/chunking-strategies",
      "ai-engineering/vector-databases-beyond-faiss",
      "ai-engineering/hybrid-search-bm25-vector",
      "ai-engineering/reranking-with-cross-encoders",
      "ai-engineering/evaluating-an-ai-app",
    ],
    "Agents + Tools + Memory": [
      "ai-engineering/what-is-an-agent",
      "ai-engineering/the-react-loop",
      "ai-engineering/mcp-tool-use",
      "ai-engineering/agent-memory",
      "ai-engineering/safety-guardrails",
    ],
    "Production + Portfolio": [
      "ai-systems/fastapi-architecture-for-ai",
      "ai-systems/streaming-responses-sse",
      "ai-engineering/observability",
      "ai-systems/semantic-caching",
      "career/three-project-portfolio",
    ],
  },
  "ai-era-beginner-readiness": {
    "Months 1–2: Programming Fundamentals": [
      "dsa/arrays-and-frequency-maps",
      "dsa/hashing-and-sets",
      "dsa/recursion-backtracking",
    ],
    "Months 3–4: Web + AI Literacy": [
      "full-stack/nextjs-app-router",
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/tokenization-and-context-windows",
      "ai-engineering/embeddings-explained",
      "ai-engineering/what-is-rag",
    ],
    "Months 5–6: First Real Project": [
      "full-stack/capstone-content-site",
      "full-stack/deploying-to-vercel",
      "ai-engineering/build-a-rag-pipeline",
      "career/three-project-portfolio",
    ],
  },
  "cs-student-ai-era-roadmap": {
    "Year 1: Foundations That Don't Expire": [
      "dsa/pattern-recognition",
      "dsa/arrays-and-frequency-maps",
      "dsa/two-pointers",
      "career/github-profile-checklist",
    ],
    "Year 2: AI + Full-Stack": [
      "ai-engineering/what-is-rag",
      "ai-engineering/build-a-rag-pipeline",
      "ai-engineering/prompt-engineering-patterns",
      "full-stack/capstone-content-site",
      "dsa/sliding-window",
    ],
    "Year 3: Specialize + Ship": [
      "ai-engineering/capstone-ship-rag",
      "career/three-project-portfolio",
      "career/ai-era-resume",
      "career/linkedin-for-engineers",
    ],
    "Final Semester: Placement Mode": [
      "career/behavioral-interviews",
      "career/tell-me-about-yourself",
      "dsa/talking-through-code",
      "career/cold-email-templates",
    ],
  },
  "final-year-placement-prep": {
    "Months 1–2: DSA Core Patterns": [
      "dsa/arrays-and-frequency-maps",
      "dsa/sliding-window",
      "dsa/two-pointers",
      "dsa/binary-search",
      "dsa/dp-without-fear",
    ],
    "Months 3–4: Project + System Design": [
      "career/three-project-portfolio",
      "dsa/design-rate-limiter",
      "ai-engineering/system-design-enterprise-rag",
      "ai-engineering/explain-rag-in-interview",
    ],
    "Month 5: Interview Mode": [
      "career/behavioral-interviews",
      "career/tell-me-about-yourself",
      "dsa/talking-through-code",
      "career/ai-era-resume",
      "career/cold-email-templates",
    ],
    "Month 6: Active Applications": [
      "career/job-search-routine",
      "dsa/pattern-recognition",
      "career/salary-negotiation",
    ],
  },
  "fullstack-dev-to-ai-engineer": {
    "Month 1: LLM API Fluency": [
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
      "ai-engineering/tokenization-and-context-windows",
      "ai-systems/streaming-responses-sse",
    ],
    "Month 2–3: RAG End-to-End": [
      "ai-engineering/what-is-rag",
      "ai-engineering/embeddings-explained",
      "ai-engineering/vector-databases-beyond-faiss",
      "ai-engineering/confidence-gates",
      "ai-engineering/evaluating-an-ai-app",
    ],
    "Month 4: Agents + FastAPI": [
      "ai-engineering/what-is-an-agent",
      "ai-engineering/building-retrieval-tools-for-agents",
      "ai-systems/fastapi-architecture-for-ai",
      "ai-systems/streaming-responses-sse",
    ],
    "Month 5–6: Ship + Showcase": [
      "ai-engineering/capstone-ship-rag",
      "career/resume-bullets-ai-projects",
      "career/three-project-portfolio",
    ],
  },
  "limited-time-professional": {
    "Month 1: Understand + Build Basic": [
      "ai-engineering/what-is-rag",
      "ai-engineering/what-is-an-agent",
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
      "career/github-profile-checklist",
      "career/linkedin-for-engineers",
      "career/three-project-portfolio",
    ],
  },
  "non-ai-engineer-to-ai-career": {
    "Months 1–3: Foundations": [
      "ml-foundations/ml-workflow-train-test-split",
      "ai-engineering/ai-app-mental-model",
      "ai-engineering/prompt-engineering-patterns",
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
      "ai-engineering/resume-bullets-ai",
    ],
    "Month 9: Job Search": [
      "career/job-search-routine",
      "career/cold-email-templates",
      "career/salary-negotiation",
    ],
  },
};

/** The lessons mapped to one roadmap stage ([] when none). */
export function stageLessons(roadmap: string, stageTitle: string): string[] {
  return ROADMAP_LESSONS[roadmap]?.[stageTitle] ?? [];
}
