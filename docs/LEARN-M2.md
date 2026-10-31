# Learn M2: measure it, then improve it, then ship it

M1 built a RAG loop that *looked* right. M2 asks "how right?", fixes what the numbers exposed,
and makes the result deployable. Every number below came from running the code in this repo.

## 1. A knowledge-base registry (`kbs.yaml`, `kb.py`)

A real deployment serves several corpora with different rules, so cairnly has a registry:

| Knowledge base | Content | Prompt | Notice |
|---|---|---|---|
| `lessons` | 162 GradStack lessons (18 public) | `answer-v1` | none |

Each one is stored as the `source` label on its documents, so search filters with one `WHERE`.
Prompts are **versioned files** (`prompts/answer-v1.md`); every answer and every eval report
names the version, so you can compare prompt changes instead of guessing.

Besides the markdown-folder connector there is a **JSONL connector** (one passage per line, one
chunk each). Both feed the same incremental sync.

## 2. Golden sets: questions with known right answers (`evals.py`)

You cannot improve what you do not measure, and measuring needs questions whose correct
source is known. cairnly does not invent them; the set comes from the lessons themselves:

- **lessons**: each lesson's quiz question. The gold answer is that lesson, but the quiz
  section itself is excluded from results ("answer key left out"), otherwise retrieval would
  trivially find the question text.

Metrics:

- **Recall@5**: how often a correct source is in the top 5. If it is not retrieved, the LLM
  cannot cite it.
- **MRR** (mean reciprocal rank): rewards putting it *first*. Rank 1 scores 1, rank 2 scores
  0.5, rank 5 scores 0.2.
- **False refusals / false accepts**: how the confidence gate behaves (next section).
- **Faithfulness** (`--judge`): an LLM reads the sources and the answer and says whether every
  claim is supported. **Citation rate**: answers that contain `[n]` markers.

## 3. What the numbers exposed: a gate that did not gate

M1 refused answers when the best similarity was below 0.55, a guess. The eval asks the lessons
questions from an unrelated corpus as negatives; a working gate refuses those.

| Cutoff | lessons: false refusals | lessons: false accepts |
|---|---|---|
| 0.55 (M1 guess) | 0% | **94%** |
| 0.60 | 0% | 45% |
| **0.67 (M2)** | **0%** | **0%** |
| 0.72 | 0% | 0% |

So at 0.55 almost every off-topic question got an answer. 0.67 is the measured sweet spot, and
the eval prints a `suggested_min_score` so it can be re-tuned whenever the corpus changes.

## 4. Improving retrieval with a reranker (`rerank.py`)

Hybrid search alone reached Recall@5 0.88 and MRR 0.75 on the lessons: the right lesson was
often found, but not ranked near the top.

A **cross-encoder** reads the question and a passage *together* and scores how well one answers
the other: more accurate than comparing two separate embeddings, but too slow for the whole
corpus. So it only re-orders the 30 candidates that hybrid search already found.

| Retrieval | lessons Recall@5 | lessons MRR | Extra time |
|---|---|---|---|
| hybrid only | 0.88 | 0.75 | n/a |
| + bge-reranker-base | 0.94 | 0.87 | 92-286 ms |
| **+ ms-marco-MiniLM-L6** | **0.94** | **0.87** | **17-51 ms** |

The smaller model matched the bigger one on quality and was about 5x faster, a reminder to
measure instead of assuming bigger is better. It is on for the lessons, and the Docker image
ships it.

## 5. Faithfulness

With the gate and reranker in place, 40 sampled lessons questions:

| | Faithfulness | Citation rate |
|---|---|---|
| lessons | 97.5% | 100% |

Caveat worth saying in an interview: the judge here is the same local model that wrote the
answers (qwen3:8b), and models grade themselves leniently. A stronger, different judge (e.g.
Claude) is the better setup once an API key is available: `LLM_PROVIDER=anthropic`.

## 6. The eval gate in CI (`evals/gates.yaml`)

CI installs Ollama, embeds the public lessons, runs the eval and **fails the build** if
Recall@5, MRR or the gate error rates cross the limits. A change that quietly breaks
retrieval now fails a pull request instead of reaching users. (The public set was only 11
questions at M2, so its limits were loose.)

## 7. Tracing (`tracing.py`, `compose.observability.yaml`)

Langfuse records one trace per question: the retrieve step (hits, best similarity), the
generate step (model, prompt version, **time to first token**) and the answer. A real local
trace: retrieve 70 ms, first token 3.3 s, total 4.4 s, so the LLM, not search, is the slow
part. Refused questions show no generate step at all.

One design detail: `/ask` streams from a generator the web server may resume on different
threads, so tracing passes span objects explicitly instead of relying on "the current span".

## 8. Deployment (`infra/`)

Three ways to run, each one tested to the extent possible tonight:

| Target | Tested how |
|---|---|
| Docker Compose | full stack up, `/ask` streamed through the containers |
| Kubernetes (Helm on kind) | installed on a local cluster; ingest job, search and UI checked |
| AWS (Terraform) | `terraform validate` + `actionlint`; **not applied** (needs an AWS account) |

The kind test found a real bug: the API's health probe needed tables that only the
post-install ingest job creates, so the first install deadlocked. The fix is the standard
split: `/livez` (process alive, no database) for liveness, `/health` (database reachable,
tables optional) for readiness. See [infra/README.md](../infra/README.md) for the AWS setup.

## Try it

```bash
uv sync --extra rerank
uv run cairnly ingest --kb lessons
uv run cairnly eval --kb lessons --gate evals/gates.yaml
uv run cairnly eval --kb lessons --judge --limit 20
```
