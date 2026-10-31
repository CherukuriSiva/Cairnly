"""Turn the site's MDX content into plain markdown for chunking and search.

Section components such as <WhyThisMatters> become "## <title>" headings, with the titles read
from content/sections.json, the same file the web pages use, so a chunk's heading matches the
heading a reader sees. Code fences are copied untouched.
"""

import json
import re
from functools import lru_cache

import yaml

from cairnly.chunk import FENCE
from cairnly.kb import ROOT

SECTIONS_FILE = ROOT / "content" / "sections.json"
MATRIX = "SkillPriorityMatrix"


@lru_cache
def section_titles() -> dict[str, str]:
    """Component name -> heading text, from content/sections.json."""
    return json.loads(SECTIONS_FILE.read_text())


# Wrapper components that open a "## Heading" section (the matrix has its own converter).
SECTIONS = {name: title for name, title in section_titles().items() if name != MATRIX}
UNWRAP = {"Body", "Code", "Diagram"}  # keep the content, drop the tags
DROP = {"SourceNote"}  # site-only widgets with no text content

ATTRS = r'(?:\s+\w+="[^"]*")*'
TAG_LINE = re.compile(r"^\s*<(/?)([A-Z]\w*)" + ATTRS + r"\s*(/?)>\s*$")
INLINE_TAG = re.compile(r"</?(" + "|".join([*SECTIONS, *UNWRAP]) + r")" + ATTRS + r"\s*>")
ROADMAP_PHASE = re.compile(r'^\s*<RoadmapPhase\s+title="([^"]*)"(?:\s+duration="([^"]*)")?\s*>\s*$')
MATRIX_PROP = re.compile(r"(\w+)=\{(\[.*?\])\}", re.S)
STRAY_TAG = re.compile(r"<[A-Z]\w*")


def split_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.index("\n---", 4)
    return yaml.safe_load(text[4:end]) or {}, text[end + 4:].lstrip("\n")


def mdx_to_markdown(body: str) -> tuple[str, list[str]]:
    """Convert known MDX components to markdown. Code fences are copied untouched."""
    out: list[str] = []
    warnings: list[str] = []
    lines = body.splitlines()
    fence: str | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if m := FENCE.match(line):
            marker = m.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            out.append(line)
        elif fence is not None:
            out.append(line)
        elif line.lstrip().startswith("<" + MATRIX):
            block = [line]
            while not block[-1].rstrip().endswith("/>") and i + 1 < len(lines):
                i += 1
                block.append(lines[i])
            out.extend(_matrix("\n".join(block)))
        elif m := ROADMAP_PHASE.match(line):
            title, duration = m.groups()
            out.append(f"## {title} ({duration})" if duration else f"## {title}")
        elif m := TAG_LINE.match(line):
            closing, name, self_closing = m.groups()
            if name in SECTIONS and not closing and not self_closing:
                out.append(f"## {SECTIONS[name]}")
            elif name in SECTIONS or name in UNWRAP or name in DROP or name == "RoadmapPhase":
                out.append("")
            else:
                warnings.append(f"unknown component <{name}>")
                out.append(line)
        else:
            line = INLINE_TAG.sub("", line)
            if STRAY_TAG.search(line):
                warnings.append(f"stray tag: {line.strip()[:60]}")
            out.append(line)
        i += 1
    return _tidy("\n".join(out)), sorted(set(warnings))


def _matrix(block: str) -> list[str]:
    labels = {"now": "Now", "soon": "Soon", "later": "Later", "ignore": "Ignore for now"}
    lines = [f"## {section_titles()[MATRIX]}"]
    for prop, items in MATRIX_PROP.findall(block):
        lines += ["", f"**{labels.get(prop, prop.title())}**", ""]
        lines += [f"- {item}" for item in json.loads(items)]
    return lines


def _tidy(text: str) -> str:
    """Collapse runs of blank lines left behind by removed tags."""
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
