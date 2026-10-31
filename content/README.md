# Content

Everything in this folder is public. The website builds its pages from it, and
`cairnly ingest` indexes the same files for the chat, so a page and a chat
citation always come from one source.

The lessons, insights and roadmaps were imported on 2026-10-31 from the
author's own GradStack lessons. Only four front-matter keys were dropped
(`isFreePreview`, `isPublicShowcase`, `stage`, `order`), because nothing here
is paid and the order now lives in `syllabus.yaml`.

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
