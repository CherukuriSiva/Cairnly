// Keep Hacker News titles that are about AI engineering. Whole words only, so "ai" never matches
// inside "said" and "rag" never matches inside "storage".

const AI_WORDS = [
  "ai",
  "llm",
  "llms",
  "gpt",
  "chatgpt",
  "gemini",
  "claude",
  "llama",
  "mistral",
  "qwen",
  "deepseek",
  "openai",
  "anthropic",
  "hugging face",
  "transformer",
  "transformers",
  "embedding",
  "embeddings",
  "rag",
  "agent",
  "agents",
  "agentic",
  "prompt",
  "prompts",
  "fine-tune",
  "fine-tuning",
  "finetune",
  "finetuning",
  "inference",
  "machine learning",
  "neural",
  "diffusion",
  "vector database",
  "mcp",
  "eval",
  "evals",
];

function wordPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<!\\w)(?:${escaped.join("|")})(?!\\w)`, "i");
}

const AI_PATTERN = wordPattern(AI_WORDS);
// "GPT5", "Llama3" and similar: a model family name glued to a version number.
const VERSIONED_PATTERN = /(?<!\w)(?:gpt|gemini|llama|claude|qwen|mistral)[- ]?\d/i;
// "model" alone is too common; it counts only next to a word that makes it an AI model.
const MODEL_PATTERN = /(?<!\w)(?:language|foundation|reasoning|open[- ]weights?|ml|vision|speech)\s+models?(?!\w)/i;

/** True when the title is about AI engineering. */
export function isAiTitle(title: string): boolean {
  return AI_PATTERN.test(title) || VERSIONED_PATTERN.test(title) || MODEL_PATTERN.test(title);
}
