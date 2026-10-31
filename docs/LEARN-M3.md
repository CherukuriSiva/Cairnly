# Learn M3: one content folder, a learning site, and a chat that points you to the lesson

M2 measured and improved the RAG loop. M3 turns cairnly into a free learning site for new
graduates: every lesson is a public page, and every chat answer links to the section to read.

## 1. Content as MDX (`content/`, `mdx.py`)

All 162 files (126 lessons, 29 insights, 7 roadmaps) were imported once from the author's own
GradStack lessons into `content/`. Four front-matter keys were dropped wherever they appeared: two
about paid access and two about ordering. Nothing is paid any more, and the order now lives
in the syllabus. Beyond that, a few files were edited by hand: the one line naming GradStack
in the full-stack capstone lesson was reworded, two lessons got MDX escapes (below), two
lessons had their examples moved to a neutral customer-support domain, and 24 lessons got a
book note (section 8). `content/README.md` lists every edit by file.

The files stay as **MDX**: markdown plus components like `<WhyThisMatters>`. The website renders
the components; the Python side needs plain text, so `mdx.py` converts each component into a
`## Heading` while ingesting. Both sides read the heading text from one file,
`content/sections.json`, so "Why this matters" is spelled the same on the page and in a chunk.

MDX is stricter than markdown: a bare `<` starts a tag and `{` starts JavaScript. Two imported
lessons had `n <= 20` and `{"text": ...}` in plain prose, which broke their pages, so they were
escaped (`\<=`, `\{`). A pytest test converts every content file and fails on any unknown tag.

## 2. The syllabus as data (`content/syllabus.yaml`, `syllabus.py`, `web/lib/syllabus.ts`)

Order is data, not code. `syllabus.yaml` lists six tracks (ML Foundations, AI Engineering, AI
Systems & MLOps, DSA, Full-Stack, Career), each with named modules ("Retrieval & RAG",
"Agents", "Interview prep", ...) and lesson slugs in reading order.

Everything that needs order reads this one file: the sidebar, breadcrumbs, the syllabus and
track pages, and the previous/next links, which run across the whole syllabus (the last ML
Foundations lesson links to the first AI Engineering lesson). A vitest test fails if a lesson
file is missing from the syllabus, listed twice, or listed without a file. The API reads the
same file to check the `track` scope.

## 3. Pages and anchors (`web/`, `pages.py`, `web/lib/anchors.ts`)

Every page is generated at build time (`next build` prerenders 174 pages; nothing reads the
disk at request time): `/syllabus`, `/<track>`, `/<track>/<lesson>`, `/roadmap/<slug>` and
`/insights/<slug>`. Lesson pages have a sidebar on desktop and a "Lessons" drawer on phones.

For a citation to open the right section, the chunk must know the `id` of its heading on the
page. Two languages compute it, so the rule is written down once and tested twice:

1. Take the heading text (for a component, its title from `sections.json`).
2. Drop link targets, backticks and `*`; lowercase; turn every run of other characters into `-`.
3. Number repeats GitHub style: `example`, `example-1`, `example-2`.

`tests/fixtures/anchors.json` holds tricky cases (duplicates, inline code, a heading inside a
code fence, roadmap phases, book notes). pytest and vitest both must produce exactly the
listed ids. During development a one-off check also compared both sides on all 162 pages:
every id matched.

## 4. Citations that open lessons (`ingest.py`, `search.py`, `answer.py`)

Ingest stores the anchor on every chunk (`chunks.anchor`, added with an `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS`, so `cairnly migrate` upgrades an existing database). Search builds each
hit's page URL from the document's front matter: `/<track>/<slug>#<anchor>` for a lesson. The
chat shows each source as a link, so "[2] What is RAG › Why this matters" opens that section.

The answer prompt changed too (`prompts/answer-learner-v1.md`): simple English, a short answer
first, jargon explained, every claim cited, and a final "Read next:" line naming the most useful
source.

## 5. Follow-up questions (`rewrite.py`)

A chat has turns. After "What is RAG?", the follow-up "How do I evaluate it?" means nothing to
a search engine: "it" lives in the earlier turn. The fix is **query rewriting**: one small LLM
call turns the follow-up and the recent turns into a standalone question ("How do I evaluate
RAG?"), and search runs on that.

Details that keep it safe and cheap:

- The browser sends at most 6 earlier turns; the API rejects more, and rejects oversized turns.
- With no earlier turns there is no extra call.
- If the rewrite fails, returns nothing, returns several lines or something too long, cairnly
  searches with the original question instead.
- The prompt treats the conversation as data, so text inside it cannot give orders.
- The `done` event reports the searched `query`; the chat shows "Searched: ..." when it
  differs, and the trace gets a `rewrite` step.

## 6. Scoped chat (`track`)

"Ask cairnly about this lesson" opens `/?q=...&track=ai-engineering`. The chat asks the
question and shows a "Scoped to AI Engineering ×" chip; while it is there, search only returns
chunks whose document is in that track (`d.meta->>'track'`). Clicking × removes the scope. An
unknown track is a 422 from the API, not a silent empty search.

## 7. Evals (`evals.py`, `evals/`)

The golden set is still each lesson's quiz question, now read straight from the MDX: 127
questions over all content (in M2 CI only saw 11 public ones). Two new sets:

- **Off-topic** (`evals/off-topic.jsonl`): 40 questions about cooking, sport, travel, health,
  gardening, money, music, history, pets and home repair. The gate should refuse them all.
  This replaces the old trick of using the other knowledge base's questions.
- **Follow-ups** (`evals/followups.jsonl`): 15 conversations with a vague follow-up, a
  hand-written standalone version, and the lessons that should be found.

Measured on 2026-11-01 (nomic-embed-text, MiniLM reranker, qwen3:8b for rewriting):

| Metric | Value |
|---|---|
| Recall@5 (127 quiz questions) | 0.937 |
| MRR | 0.873 |
| Lowest on-topic best similarity | 0.730 |
| Highest off-topic best similarity | 0.676 |
| False refusals / false accepts at 0.67 | 0% / 2.5% (1 of 40) |
| False refusals / false accepts at **0.70** (new gate) | **0% / 0%** |
| Follow-ups Recall@5: standalone vs rewritten | 0.867 vs 0.867, then 0.933 vs 0.933 on two later runs (passes: rewritten ≥ standalone) |

The gate moved from 0.67 to 0.70, the middle of the gap ([ADR 0011](adr/0011-recalibrated-confidence-gate.md)).
The CI limits in `evals/gates.yaml` sit a little below these numbers: Recall@5 0.90, MRR 0.83,
both gate error rates at most 5%.

The follow-up result is honest rather than impressive: rewritten follow-ups found a right
lesson exactly as often as the hand-written questions (13 of 15 each on the first run, 14 of 15
each on later runs, after two lessons were edited and re-ingested: the index changed, so both
sides moved together), and a few rewrites left a vague phrase ("that setup") unresolved. A larger
rewrite model, or two or three examples in the rewrite prompt, is the next thing to try.

## 8. Book notes (`<BookNote>`)

24 lessons end their body with a short note on an idea from Chip Huyen's "AI Engineering"
(O'Reilly, 2025), for example self-delusion as a cause of hallucinations next to the
hallucinations lesson, or exact versus semantic caches next to semantic caching. The rules:

- Our own words, 120-250 words each. No copied sentences, figures, tables or lists. A script
  checked that no eight-word sequence appears in both a note and the book.
- Each note ends with `Further reading: Chip Huyen, AI Engineering (O'Reilly, 2025), chapter N`.
- The note is a normal section with its own heading, so the chat can find and cite it.

## 9. News page (`web/lib/news/`, `web/app/news/page.tsx`)

`/news` shows fresh AI-engineering reading. It is the one page that is not fully static.

- **Sources.** Hacker News (only titles that look like AI), arXiv, Hugging Face daily papers,
  and the blogs of AI labs and practitioners. They are listed as data in `sources.ts`.
- **ISR.** ISR means "incremental static regeneration". The page is built once, served fast, and
  rebuilt in the background at most once an hour (`revalidate = 3600`). Readers never wait for
  the feeds.
- **Last good.** If a source is down, the server keeps showing the last items it got from that
  source. The copy lives in the server's memory, so a restart starts empty until the next good
  fetch. One failing source never breaks the page or the build.
- **Safe text.** Feed text is untrusted. It is turned into plain text (tags removed, entities
  decoded, 200 characters at most) and only http and https links are shown. Links open in a new tab.
- **LinkedIn.** LinkedIn gives no public way to read other people's posts and forbids scraping,
  so we do not do that (see ADR 0012). The owner adds links by hand in
  `content/news/linkedin.yaml`. Only the link is shown; no LinkedIn script is loaded.
- **Chat.** News is not indexed, so the chat cannot cite it.

## Try it

```bash
docker compose up -d db
uv run cairnly migrate && uv run cairnly ingest --kb lessons
uv run cairnly eval --kb lessons -k 5 --gate evals/gates.yaml
uv run cairnly eval-followups
uv run cairnly serve
cd web && npm test && npm run dev   # open http://localhost:3010/syllabus
```
