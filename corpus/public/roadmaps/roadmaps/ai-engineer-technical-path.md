---
title: The AI Engineer Technical Path
topic: roadmaps
kind: roadmap
level: all
tags:
- roadmap
- ai-engineering
---

This is the canonical technical path for becoming an AI engineer who builds with LLMs. It is not the path for training foundation models — that requires a PhD and large compute. This path is accessible to any CS student or software engineer willing to build real things.

## Python + Git + HTTP (Weeks 1–4)
- Python fluency: data structures, comprehensions, async basics, virtualenvs, and reading tracebacks without panic.
- Git for real work: branches, commits, pull requests, resolving conflicts.
- HTTP and REST APIs: requests/responses, status codes, JSON, authentication headers.
- Environment setup: a working editor, `.env` handling, and a repeatable project scaffold you can spin up in minutes.

## ML + LLM Foundations (Weeks 5–10)
- How models actually work: training vs inference, parameters, the difference between an LLM and classic ML.
- Prompting fundamentals: system vs user roles, few-shot, structured output, why prompts are unreliable.
- Tokenization: tokens vs words, context windows, why long inputs cost more and truncate.
- Embeddings: what a vector is, semantic similarity, when embeddings beat keyword search.
- Calling LLM APIs: streaming, temperature, max tokens, cost per call, handling rate limits.

## RAG End-to-End (Weeks 11–18)
- Chunking strategies: fixed-size, semantic, overlap, and why naive chunking ruins retrieval.
- Vector search: storing embeddings (pgvector or Qdrant), top-k retrieval, metadata filtering.
- Retrieval orchestration: query rewriting, hybrid search, re-ranking when top-k isn't enough.
- Evaluation: building a golden question set, measuring retrieval hit rate and answer faithfulness.
- Production RAG: caching, freshness, handling "I don't know," and keeping the index in sync with source data.

## Agents + Tools + Memory (Weeks 19–26)
- The agent loop: plan, act, observe, repeat — and when an agent is overkill versus a single call.
- Tool use: defining tools, parsing tool calls, executing them safely, returning results to the model.
- MCP: connecting agents to external tools and data sources through a standard protocol.
- Memory: short-term conversation state vs long-term stored memory, and when each matters.
- Guardrails: input validation, output filtering, loop limits, and graceful failure.

## Production + Portfolio (Weeks 27–34)
- Deployment: containerize the app, deploy a Python backend (FastAPI), serve streaming responses.
- Observability: trace every LLM call, log prompts and outputs, surface latency and errors.
- Cost control: token budgeting, caching, model routing (cheap model first, escalate when needed).
- Ship one portfolio project end-to-end and write it up: the problem, the architecture, the trade-offs, and the results.

## Skill priorities

**Now**

- Python fluency
- Git + building real projects
- RAG fundamentals
- Prompt engineering

**Soon**

- Agent patterns + tool use
- Evaluation and guardrails
- FastAPI + deployment

**Later**

- Fine-tuning and LoRA
- Multi-agent systems
- Custom model training

**Ignore for now**

- Chasing every new framework
- Leetcode-only prep
- Tutorial marathons without building
- "Learn everything" lists
