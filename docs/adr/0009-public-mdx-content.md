# ADR 0009: Publish all content as MDX, one source for pages and chat

Status: accepted (M3)

## Context

Until M3, cairnly converted the author's GradStack MDX lessons into a separate markdown corpus
(`corpus/`), shipped only the 18 free files, and kept the rest local (ADR 0004). The chat had no
pages to link to, so a citation could only name a file and line range. On 2026-10-31 the
author decided to make every lesson public and to turn cairnly into a learning site for new
graduates.

## Decision

- Import all 162 MDX files (126 lessons, 29 insights, 7 roadmaps) once into `content/`, with
  only the front-matter keys for paid access and the old ordering dropped. `corpus/`,
  `curate.py` and `CURATION.md` are deleted.
- `content/syllabus.yaml` is the only source of order: six tracks, named modules, lesson slugs.
- The web app generates static pages from `content/` at build time, and `cairnly ingest`
  indexes the same files, converting MDX with `mdx.py`.
- Section headings come from `content/sections.json`, read by both sides, and one heading-id
  rule (`pages.py` and `web/lib/anchors.ts`, tested against one shared fixture) gives every
  chunk the id of its section on the page. Citations link to `/<track>/<slug>#<anchor>`.

## Consequences

- A citation opens the exact section a reader should read, and the page and the chat can never
  disagree about the content.
- The anchor rule is a cross-language contract: changing it on one side breaks citation links,
  so both test suites check the same fixture.
- MDX is stricter than markdown: a bare `<` or `{` in prose breaks the page build, so two
  imported lessons needed escapes.
- Adding a lesson means adding the file and listing it in `syllabus.yaml`; a test fails if the
  two disagree.
