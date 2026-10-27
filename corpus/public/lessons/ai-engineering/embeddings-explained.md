---
title: 'Embeddings Explained: From Text to Vectors'
topic: ai-engineering
kind: lesson
level: beginner
tags:
- ai-engineering
- foundations
---

## What you will learn
- Define what an embedding is and why it exists
- Explain how text becomes a fixed-length numeric vector
- Compare cosine similarity and dot product for measuring closeness
- Identify which embedding model to pick for a first project

## Why this matters
Embeddings are the bridge between human language and machine math. Every RAG pipeline, every semantic search engine, every recommendation system runs on embeddings under the hood. If you don't understand what they are, you can't debug retrieval failures, tune similarity thresholds, or explain your system to an interviewer.

## What is an embedding?

An embedding is a fixed-length array of floating-point numbers that represents the *meaning* of a piece of text. The word "fixed-length" is important: whether you embed the sentence "I love dogs" or a 500-word paragraph about veterinary medicine, the output is always the same number of dimensions — typically 384, 768, or 1536 floats depending on the model.

The key property: **texts with similar meaning land close together in vector space**. "How do I reset my password?" and "I forgot my login credentials" will produce vectors that point in nearly the same direction, even though they share almost no words.

## How text becomes a vector

Modern embedding models are neural networks (usually transformers) trained on enormous text corpora. The training objective varies, but the most common one is **contrastive learning**: the model sees pairs of texts that are semantically similar (positive pairs) and pairs that are unrelated (negative pairs). It learns to push positive-pair vectors together and negative-pair vectors apart.

At inference time, you pass a string into the model and get back a vector. In Python with the `sentence-transformers` library:

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-small-en-v1.5")
vector = model.encode("How do I reset my password?")
print(vector.shape)  # (384,)
```

The model tokenizes the text, runs it through transformer layers, and pools the final hidden states into a single vector. That vector is your embedding.

## Measuring closeness: cosine similarity vs dot product

Once you have two vectors, you need a way to say "how similar are they?" The two most common metrics are:

**Cosine similarity** measures the angle between two vectors, ignoring magnitude. It returns a value between -1 and 1. Two vectors pointing in exactly the same direction score 1.0 regardless of their length.

**Dot product** multiplies corresponding elements and sums the results. It accounts for both direction and magnitude. If your vectors are L2-normalized (each has length 1), then the dot product equals cosine similarity — this is why many systems normalize embeddings before indexing.

For most RAG applications, **normalize your vectors and use dot product**. It's faster (no extra division step) and equivalent to cosine similarity after normalization.

## Which embedding model should you pick?

For your first project, use one of these:

| Model | Dimensions | Speed | Quality | Notes |
|---|---|---|---|---|
| `bge-small-en-v1.5` | 384 | Fast | Good | Best starter model, runs on CPU |
| `text-embedding-3-small` | 1536 | API call | Very good | OpenAI hosted, costs ~$0.02/1M tokens |
| `nomic-embed-text-v1.5` | 768 | Medium | Very good | Open-source, Matryoshka support |

Start with `bge-small-en-v1.5`. It runs locally, requires no API key, and produces embeddings good enough for most use cases. Switch to a larger model only after you've measured retrieval quality and found it lacking.

## Common misconceptions

**"Bigger embeddings are always better."** Not true. A 384-dim model often retrieves as well as a 1536-dim model for domain-specific tasks because retrieval quality depends more on the training data and chunking strategy than raw dimensionality.

**"I can mix embedding models."** Never do this. The query embedding and the document embeddings must come from the same model. Vectors from different models live in incompatible spaces — comparing them is meaningless.

**"Embeddings capture everything about the text."** They capture *semantic similarity as defined by the training data*. They don't capture formatting, exact phrasing, or domain-specific jargon unless the model was trained on it.

## Quick quiz
**Q: You embed all your documents with `bge-small-en-v1.5` but embed user queries with `text-embedding-3-small`. Retrieval quality is terrible. Why?**

- A) The documents are too long
- B) The models produce vectors in different spaces — you can't compare them ✅
- C) You need to use L2 distance instead of cosine similarity
- D) The OpenAI model is lower quality

## How to explain it in an interview
"An embedding is a fixed-length vector of floats that captures the semantic meaning of text. Texts with similar meaning produce vectors that are close together, measured by cosine similarity or dot product. I'd generate embeddings using a transformer model like bge-small or OpenAI's text-embedding-3-small, normalize them, and use dot product for fast similarity search. The critical rule is that query and document embeddings must come from the same model — mixing models produces meaningless comparisons."
