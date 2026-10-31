# ADR 0012: Open feeds for the News page; no LinkedIn scraping

Status: accepted (M3)

## Context

The owner asked for a "LinkedIn news" section with the latest AI-engineering posts. On
2026-11-01 we checked what is possible. LinkedIn has no public API for reading other people's
posts or comments, and its terms forbid scraping. Embedding posts needs LinkedIn's scripts and
cookies on our pages. Open sources do give good AI-engineering reading: Hacker News, arXiv,
Hugging Face daily papers, and RSS or Atom feeds from AI labs and practitioner blogs.

## Decision

Add a News page at `/news` with two parts.

- **Latest** comes from the open sources above. The server fetches them, the page is refreshed
  at most once an hour (ISR), and a source that fails keeps showing its last good items. Each
  item shows the title, source, date and at most 200 characters of the feed's own summary,
  and links to the original in a new tab.
- **LinkedIn picks** come from `content/news/linkedin.yaml`, written by the owner. Each pick is a
  plain link card. There is no LinkedIn embed, script or cookie.

The chat does not index news.

## Consequences

- No LinkedIn terms are broken, and no one else's content is republished beyond a short summary
  with a link.
- `/news` is the only page that is not fully static. It needs the web server to reach the
  internet (ECS has NAT egress). If a build or a server has no network, the page shows a
  "couldn't reach these sources" line until the next good refresh.
- The picks file is read from disk at each refresh, so the web image copies `content/news` to
  `/content/news` (the server's `../content`). If it is missing, the page shows no picks and the
  server logs a warning naming the path.
- The last-good copy is in the server's memory, so it starts empty after a restart or deploy.
- The Anthropic and LangChain blog feeds were left out: the first returned 404 and the second
  returned HTML when we checked. Add them back when they publish a working feed.
- The arXiv API terms ask for an acknowledgement, so the page carries one.
