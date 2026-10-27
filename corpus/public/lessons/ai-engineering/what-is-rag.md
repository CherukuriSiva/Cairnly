---
title: What is RAG and When Does It Beat Pure Prompting
topic: ai-engineering
kind: lesson
level: beginner
tags:
- ai-engineering
- foundations
---

## What you will learn
- Define Retrieval-Augmented Generation (RAG) in one sentence
- Identify when RAG beats pure prompting
- Sketch the 3-stage RAG pipeline: retrieve → augment → generate

## Why this matters
Every AI engineering interview in 2026 asks "when would you use RAG?" If you can't answer crisply, you're filtered out before the coding round. More importantly, RAG is the architecture behind most production AI apps — not fine-tuning, not agents, not prompt chains.

## The core idea

RAG stands for **Retrieval-Augmented Generation**. Instead of asking an LLM to answer from memory (pure prompting), you first *retrieve* relevant documents from your own data, then *augment* the prompt with those documents, then *generate* an answer grounded in real sources.

## When RAG beats pure prompting

Pure prompting fails when:
1. **The knowledge isn't in the training data** — your company's internal docs, a niche textbook, recent events
2. **You need citations** — the user must verify the answer against a source
3. **Hallucination is unacceptable** — medical, legal, financial domains

## The 3-stage pipeline

1. **Retrieve** — embed the user's query, search a vector index, get top-k relevant passages
2. **Augment** — insert those passages into the LLM prompt as context
3. **Generate** — the LLM answers using the provided context, not just its training data

## Quick quiz
**Q: A user asks your chatbot about a policy document uploaded last week. The LLM was trained in 2024. Should you use RAG or pure prompting?**

- A) Pure prompting — the LLM can infer the answer
- B) RAG — the document isn't in the training data ✅
- C) Fine-tuning — retrain the model on the document

## How to explain it in an interview
"RAG retrieves relevant documents from a private corpus and injects them into the LLM prompt before generation. I'd use it over pure prompting whenever the answer depends on data the model wasn't trained on, when I need source citations, or when hallucination risk is too high. The tradeoff is added latency from the retrieval step and the need to maintain a vector index."
