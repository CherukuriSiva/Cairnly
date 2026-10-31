"""Page URLs and heading anchors, so a chat citation opens the right section of a page.

The anchor rule must match the web's remark plugin (web/lib/anchors.ts) exactly; both sides are
tested against tests/fixtures/anchors.json.
- slugify: drop link targets, decode HTML entities, remove backticks and `*`, lowercase, turn
  every run of characters outside [a-z0-9] into "-", trim "-"; an empty result is "section".
- Headings (h1-h3, outside code fences) get anchors in document order; the first use of a slug
  keeps it, later repeats get -1, -2, ... (skipping values already used).
"""

import html
import re
from bisect import bisect_right

from cairnly.chunk import HEADING, fence_mask

LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")


def slugify(text: str) -> str:
    text = LINK.sub(r"\1", text)
    text = html.unescape(text).replace("`", "").replace("*", "").lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "section"


def unique_slugs(texts: list[str]) -> list[str]:
    """Slug each heading text in order, de-duplicating GitHub style (-1, -2, ...)."""
    used: set[str] = set()
    out: list[str] = []
    for text in texts:
        base = slug = slugify(text)
        n = 0
        while slug in used:
            n += 1
            slug = f"{base}-{n}"
        used.add(slug)
        out.append(slug)
    return out


def heading_anchors(markdown: str) -> list[tuple[int, str]]:
    """(1-based line number, anchor) for every h1-h3 heading in converted markdown."""
    lines = markdown.splitlines()
    in_fence = fence_mask(lines)
    found = [(i + 1, m.group(2)) for i, line in enumerate(lines)
             if not in_fence[i] and (m := HEADING.match(line))]
    return list(zip([n for n, _ in found], unique_slugs([t for _, t in found]), strict=True))


def anchor_at(anchors: list[tuple[int, str]], line: int) -> str:
    """The anchor of the last heading at or before `line`, or "" when there is none."""
    i = bisect_right([n for n, _ in anchors], line)
    return anchors[i - 1][1] if i else ""


def page_url(path: str, meta: dict, anchor: str = "") -> str:
    """Site URL of an ingested document: lessons, roadmaps and insights have pages."""
    kind = path.split("/", 1)[0]
    slug = meta.get("slug")
    if kind == "lessons" and slug and meta.get("track"):
        url = f"/{meta['track']}/{slug}"
    elif kind == "roadmaps" and slug:
        url = f"/roadmap/{slug}"
    elif kind == "insights" and slug:
        url = f"/insights/{slug}"
    else:
        return ""
    return f"{url}#{anchor}" if anchor else url
