"""Split markdown into one chunk per heading section (h1-h3).

A heading section is a unit a human would cite ("Lesson > The core idea", lines 12-30), which a
fixed token window is not. Sections longer than `max_chars` split at blank lines, never inside a
code fence, so a chunk never holds half a code block.
"""

import re
from dataclasses import dataclass

HEADING = re.compile(r"^(#{1,3})\s+(\S.*?)\s*#*\s*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


@dataclass(frozen=True)
class Chunk:
    trail: str  # heading path, e.g. "The core idea > Retrieve"; "" before the first heading
    start_line: int  # 1-based, inclusive, counted in the body (after front matter)
    end_line: int
    text: str
    anchor: str = ""  # id of the section's heading on the rendered page; "" when none


def chunk_markdown(body: str, max_chars: int = 1800) -> list[Chunk]:
    lines = body.splitlines()
    in_fence = fence_mask(lines)
    chunks: list[Chunk] = []
    for trail, start, end in _sections(lines, in_fence):
        if not any(line.strip() for line in lines[start:end + 1]):
            continue
        for s, e in _split(lines, in_fence, start, end, max_chars):
            text = "\n".join(lines[s:e + 1]).strip()
            if text and not HEADING.match(text):  # skip heading-only pieces
                chunks.append(Chunk(trail, s + 1, e + 1, text))
    return chunks


def fence_mask(lines: list[str]) -> list[bool]:
    mask, fence = [], None
    for line in lines:
        m = FENCE.match(line)
        if fence is None and m:
            fence = m.group(1)
            mask.append(True)
        elif fence is not None:
            mask.append(True)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
        else:
            mask.append(False)
    return mask


def _sections(lines: list[str], in_fence: list[bool]):
    """Yield (trail, start, end) per section; each section starts at its heading line."""
    stack: list[tuple[int, str]] = []  # (level, title) of the open headings
    trail, start = "", 0
    for i, line in enumerate(lines):
        m = None if in_fence[i] else HEADING.match(line)
        if not m:
            continue
        if i > start:
            yield trail, start, i - 1
        level = len(m.group(1))
        stack = [(lv, t) for lv, t in stack if lv < level] + [(level, m.group(2))]
        trail, start = " > ".join(t for _, t in stack), i
    if start < len(lines):
        yield trail, start, len(lines) - 1


def _split(lines, in_fence, start: int, end: int, max_chars: int):
    """Cut [start, end] into pieces of at most ~max_chars, at blank lines outside fences."""
    piece_start, size = start, 0
    for i in range(start, end + 1):
        size += len(lines[i]) + 1
        blank_cut = not lines[i].strip() and not in_fence[i]
        if size >= max_chars and blank_cut and i < end:
            yield piece_start, i
            piece_start, size = i + 1, 0
    if piece_start <= end:
        yield piece_start, end
