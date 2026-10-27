---
title: 'Full-Stack Dev to AI Engineer: The 6-Month Transition'
topic: roadmaps
kind: roadmap
level: all
tags:
- transition
- ai-engineering
- full-stack
- career-change
---

Full-stack developers have a massive advantage in AI engineering: you can already build real products, understand databases, and know how to deploy code. The gap is narrow. You need: LLM APIs + RAG + evaluation + one shipped AI feature.

## Month 1: LLM API Fluency (4 weeks)
- Pick an LLM provider (Anthropic or OpenAI) and commit to it for now.
- Build a basic chatbot and a summarizer — small, working, end-to-end.
- Understand tokens, context windows, streaming responses, and cost per call.
- Integrate the model into a project you already own, so you're learning on familiar ground.

## Month 2–3: RAG End-to-End (8 weeks)
- Add RAG to your existing project, or build a document-question-answering system from scratch.
- Embedding: turn your documents into vectors.
- Vector store: start with Qdrant or pgvector — you already know Postgres, so lean into it.
- Retrieval: top-k, metadata filtering, and handling "no good match."
- Evaluation: a small golden set to measure whether answers are actually grounded.

## Month 4: Agents + FastAPI (4 weeks)
- Build a simple agent with tool use: file search and a web call are enough to learn the loop.
- Replace your Express/Next.js API with a FastAPI Python backend for the AI layer.
- Understand streaming for LLM responses so the UX feels live, not frozen.

## Month 5–6: Ship + Showcase (8 weeks)
- Ship a full project combining your web skills with AI features.
- Write it up: the problem, the architecture, and the trade-offs you made.
- Update your resume with AI projects framed in outcomes, not buzzwords.
- Apply to AI engineering roles — your shipping track record is the differentiator.

## Skill priorities

**Now**

- LLM API usage (Anthropic/OpenAI)
- RAG with a real document corpus
- Evaluation basics
- FastAPI for Python services

**Soon**

- Agents with tool use
- MLOps and deployment
- Observability and cost tracking

**Later**

- Fine-tuning
- Multi-agent systems
- Custom embedding models

**Ignore for now**

- Relearning web fundamentals you already know
- Deep ML theory (that's Type 2 engineering)
- Framework-hopping
- Rebuilding your entire stack from scratch
