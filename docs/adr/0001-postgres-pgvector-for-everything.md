# ADR 0001: Postgres + pgvector for documents, keyword search and vectors

Status: accepted (M1)

## Context

RAG needs three stores: document metadata, a keyword index and a vector index. Common setups
use a separate vector database (Qdrant, Pinecone) next to a search engine (OpenSearch).

## Decision

One Postgres database: relational tables for documents and chunks, a generated `tsvector`
column with a GIN index for keyword search, and a `vector(768)` column with an HNSW index.

## Consequences

- One service to run, back up and secure. Updates to a document and its chunks happen in one
  transaction, so the indexes never disagree.
- Multi-tenancy later (M6) can use row-level security, a Postgres feature.
- Postgres full-text ranking is not true BM25. Acceptable for M1; revisit if evals show
  keyword recall is the bottleneck.
- At hundreds of millions of vectors a dedicated vector store may win. Customer-sized doc sets
  are far below that.
