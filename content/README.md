# Content

Everything in this folder is public. The website builds its pages from it, and
`cairnly ingest` indexes the same files for the chat, so a page and a chat
citation always come from one source.

The lessons, insights and roadmaps were imported on 2026-10-31 from the
author's own GradStack lessons. These are all the edits made to the imported
files:

- Four front-matter keys were dropped wherever they appeared (`isFreePreview` from every
  file; `isPublicShowcase`, `stage` and `order` from the lessons, the only files that had
  them), because nothing here is paid and the
  order now lives in `syllabus.yaml`.
- `lessons/full-stack/capstone-content-site.mdx`: the one line naming
  GradStack now reads "Share the live URL with a friend or mentor for review".
- Two MDX escapes, because MDX reads `<` as a tag and `{` as code:
  `lessons/dsa/pattern-recognition.mdx` (`<=` became `\<=`) and
  `lessons/ai-engineering/formatting-data-for-sft.mdx` (`{\"text\": ...}` became
  `\{"text": ...}`).
- Two examples moved to a neutral customer-support domain:
  `lessons/ai-engineering/relevance-filtering-corpus.mdx` (a customer-support
  assistant and `SUPPORT_KEYWORDS`) and
  `lessons/ai-engineering/formatting-data-for-sft.mdx` (module `support_qa`).
- 24 lessons got a new `<BookNote>` block in our own words (see below).

## Layout

| Path | What it holds | Page URL |
|---|---|---|
| `lessons/<track>/<slug>.mdx` | one lesson | `/<track>/<slug>` |
| `insights/<category>/<slug>.mdx` | one insight | `/insights/<slug>` |
| `roadmaps/<slug>.mdx` | one roadmap | `/roadmap/<slug>` |
| `syllabus.yaml` | tracks, modules and lesson order | `/syllabus`, `/<track>` |
| `sections.json` | heading text for each section component | used by both sides |

## syllabus.yaml and sections.json

`syllabus.yaml` is the only place that sets order. It lists six tracks; each
track has named modules, and each module lists lesson slugs. Previous/next
links follow this order across the whole syllabus. A test fails when a lesson
file is missing from the syllabus, is listed twice, or a listed slug has no
file.

`sections.json` maps each section component (for example `<WhyThisMatters>`)
to its heading text. The web components and the Python converter both read it,
so a page heading and a chunk's citation anchor always match.

## Add a lesson

1. Create `lessons/<track>/<slug>.mdx` with front matter `slug`, `title`,
   `track`, `tier`, `estimatedMinutes` and `difficulty`. The slug must equal the
   file name.
2. Add the slug to a module of that track in `syllabus.yaml`.
3. Run `cd web && npm test` (syllabus and link checks) and
   `uv run cairnly ingest --kb lessons` to index it for the chat.

## Book notes

Some lessons carry a `<BookNote chapter="N">` block right after `</Body>`. It
is our own short explanation of an idea from Chip Huyen's book "AI
Engineering" that matters for that lesson. It never copies sentences, figures,
tables or lists from the book, and its last line is always:

```
Further reading: Chip Huyen, AI Engineering (O'Reilly, 2025), chapter N
```

## Insights

Insights summarise recurring public industry discussions in our own words.
Each insight page keeps its own source note at the bottom.

## News

The News page (`/news`) lists fresh items from open feeds, fetched when the server
refreshes the page, and a few hand-picked LinkedIn posts. The picks live in
`news/linkedin.yaml`: each entry has a `url` (an https `linkedin.com` link), an
`author`, a `title`, and optionally a `note` and a `date`. Entries that do not fit
are skipped. This file is not MDX, so the chat never indexes it. The web server reads it at each
hourly refresh, so the web image includes `content/news`.

## License

The content in this folder is licensed under CC BY-NC-SA 4.0, with a note on insights and
book notes: see [LICENSE.md](LICENSE.md). Like this README, the license file is a notice about
the folder, so `cairnly ingest` skips it and the chat never cites it.
