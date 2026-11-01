# ADR 0016: A written question set per lesson, and the confidence gate re-measured with it

Status: accepted (cycle 4, 2026-11-01). Re-measures the gate set in ADR 0011 and keeps 0.70.

## Context

ADR 0011 set `min_score` to 0.70 from 127 quiz questions and 40 off-topic questions. Quiz
questions are long and precise, so they score well above anything a learner types in a hurry:
"What is a jailbreak?" was refused at 0.668 although two lessons teach jailbreaks. The gate
and the README numbers were trusted on a set that did not look like real questions.

This cycle built a set that does:

- **Written questions** (`evals/questions/<track>.jsonl`, 500 rows): 3 to 5 per lesson for all
  126 lessons, written in our own words from each lesson. Each lesson gets a short question
  (6 words or fewer), a how or why question, an applied scenario and, on long lessons, a
  comparison. Each row names its gold lesson and the section heading that answers it; a test
  checks that the section exists, that every lesson has 3 to 5 rows, that no row repeats a
  quiz question, and that no question shares 8 consecutive words with its lesson. A second
  gold path is listed only where another document answers just as directly.
- **Off-topic set** (`evals/off-topic.jsonl`) grown from 40 to 150: the 40 everyday questions,
  plus near-miss technology the lessons do not teach (Excel and Word, phone and laptop
  settings, Wi-Fi, gaming hardware, photo editing, crypto trading) and more everyday topics.
- **One combined golden set**: the eval scores quiz and written questions together and reports
  each source separately (`by_source`), so the quiz numbers stay comparable to M3. The
  `--out` report also lists every miss, every refused question and every accepted off-topic
  question.

After the first run, three written misses got a second gold path because a retrieved document
answers them just as directly (no question was reworded): "RAG or fine-tuning?" (the
fine-tuning-vs-rag insight and interviewer-questions-ai), the minimum window substring
question and the days-until-a-higher-price question (both classified in pattern-recognition).
Ten written questions remain real retrieval misses.

## Measurement (2026-11-01, nomic-embed-text, cross-encoder reranker, k = 5)

| min_score 0.70 | Questions | Recall@5 | MRR | False refusals | False accepts |
|---|---|---|---|---|---|
| Combined | 627 | 0.9713 | 0.9138 | 15.3% (96 of 627) | 0% (0 of 150) |
| Quiz | 127 | 0.937 | 0.873 | 0% (0 of 127) | 0% |
| Written | 500 | 0.980 | 0.9242 | 19.2% (96 of 500) | 0% |

`cairnly eval` suggests 0.636. At that cutoff rounded to 0.64: 2.1% false refusals (13 of
627) and **8.0% false accepts (12 of 150)**. Other cutoffs, for reference:

| min_score | False refusals | False accepts |
|---|---|---|
| 0.64 | 2.1% (13) | 8.0% (12) |
| 0.66 | 5.1% (32) | 2.7% (4) |
| 0.68 | 9.6% (60) | 0% |
| 0.70 | 15.3% (96) | 0% |

The two sides overlap between 0.535 and 0.676:

- Highest off-topic scores: 0.676 "How often should I practise piano as a beginner?", 0.666
  "How do I make sourdough starter from scratch?", 0.662 "How do I learn to draw realistic
  portraits?", 0.652 "How do I set up an out-of-office reply in Outlook?", 0.646 "Which Excel
  formula counts cells that match two conditions?".
- Lowest on-topic scores: 0.535 "pgvector vs Pinecone?", 0.570 "What is Gini impurity?", 0.604
  "What does the sigmoid function do?", 0.614 "IndexFlatL2 vs IndexFlatIP?", 0.630 "How many
  workers for 1000 RPS?".
- "What is a jailbreak?" scores 0.668: refused at 0.70, accepted at 0.66 and below.

Short questions are refused most often: 34 of the 122 written questions of 6 words or fewer
(28%), against 62 of the 378 longer ones (16%).

## Decision

Keep `min_score` at 0.70. The owner's rule was to adopt the suggested cutoff only if its false
accept rate is at most 5%; at 0.64 it is 8%, so the suggestion is not adopted. The overlap is
recorded as a known gap rather than tuned away.

CI thresholds in `evals/gates.yaml` are re-set just under the measured values: each minimum is
the measured value minus 0.03, rounded down, and each rate maximum is the larger of 0.05 and
the measured value plus 0.03, rounded up.

| Metric | Measured | CI limit |
|---|---|---|
| recall@5 | 0.9713 | ≥ 0.94 |
| mrr | 0.9138 | ≥ 0.88 |
| false_refusal_rate | 0.1531 | ≤ 0.19 |
| false_accept_rate | 0.0 | ≤ 0.05 |

## Consequences

- The README now quotes the combined numbers. At 0.70 the gate refuses about one written
  question in five (19.2%); the quiz-only view showed 0%.
- The full eval (777 searches with the reranker) took about 108 seconds on the development
  Mac; the CI runner's time is not measured yet. CI runs the full set, no sampling.
- Every written and off-topic question also runs through the input guard in
  `cairnly eval-redteam`: 0 of 955 allowed questions blocked, so the guard rules did not change.
- Lowering the gate is a product choice this ADR leaves open: 0.68 keeps 0 of 150 false accepts
  and refuses 60 instead of 96; 0.66 refuses 32 but answers 4 off-topic questions. The better
  fix is retrieval that scores short questions higher (query rewriting, or a gate that also
  uses the reranker score), measured on this set.
- The cutoff is still tied to the embedding model (`nomic-embed-text`).
