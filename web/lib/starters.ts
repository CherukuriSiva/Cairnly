// Sample questions shown on the landing page (chips, rotating placeholder) and in the empty chat.

export const STARTERS = [
  "What is RAG, and when should I use it instead of fine-tuning?",
  "How do I evaluate an LLM app before I ship it?",
  "What is an AI agent, and when do I actually need one?",
  "How do I protect my app from prompt injection?",
  "How do tokens and context windows affect cost?",
  "Which projects should I build for an AI engineer portfolio?",
] as const;

/** The chat link that asks one question. */
export function askHref(question: string, track?: string | null): string {
  const q = `q=${encodeURIComponent(question)}`;
  return track ? `/ask?${q}&track=${encodeURIComponent(track)}` : `/ask?${q}`;
}
