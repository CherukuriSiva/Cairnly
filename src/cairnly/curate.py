"""Turn GradStack MDX lessons into plain markdown with normalized front matter.

"Copy, but don't blindly copy": every file gets a decision and a reason, written to
CURATION.md. The source folder is only ever read.

Decisions:
- public:     free lesson or roadmap, written to corpus/public (committed)
- local-only: paid lesson, or built from third-party posts; written to corpus/private
              (git-ignored) so the local demo can still use it
- dropped:    stub or duplicate; not written
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

# MDX wrapper components that become a "## Heading" section in plain markdown.
SECTIONS = {
    "WhatYouWillLearn": "What you will learn",
    "WhyThisMatters": "Why this matters",
    "MiniQuiz": "Quick quiz",
    "InterviewExplanation": "How to explain it in an interview",
    "CommonMistakes": "Common mistakes",
    "TryItYourself": "Try it yourself",
    "CompletionChecklist": "Checklist",
    "WhatToDoNext": "What to do next",
    "KeyTakeaways": "Key takeaways",
    "InsightSummary": "Summary",
    "ResumeBullet": "Resume bullet",
    "DebuggingChecklist": "Debugging checklist",
}
UNWRAP = {"Body", "Code", "Diagram"}  # keep the content, drop the tags
DROP = {"SourceNote"}  # site-only widgets with no text content
LEVELS = {"easy": "beginner", "medium": "intermediate", "hard": "advanced"}
THIRD_PARTY = {"linkedin", "mixed"}
MIN_WORDS = 150

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
TAG_LINE = re.compile(r"^\s*<(/?)([A-Z]\w*)\s*(/?)>\s*$")
INLINE_TAG = re.compile(r"</?(" + "|".join([*SECTIONS, *UNWRAP]) + r")>")
ROADMAP_PHASE = re.compile(r'^\s*<RoadmapPhase\s+title="([^"]*)"(?:\s+duration="([^"]*)")?\s*>\s*$')
MATRIX_PROP = re.compile(r"(\w+)=\{(\[.*?\])\}", re.S)
STRAY_TAG = re.compile(r"<[A-Z]\w*")


@dataclass
class Curated:
    source: str  # path relative to the content root
    kind: str  # lesson | insight | roadmap
    topic: str
    slug: str
    title: str
    access: str  # free | paid
    decision: str = "public"
    reason: str = ""
    flags: list[str] = field(default_factory=list)
    markdown: str = ""

    @property
    def out_path(self) -> str:
        area = "public" if self.decision == "public" else "private"
        return f"{area}/{self.kind}s/{self.topic}/{self.slug}.md"


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
        elif line.lstrip().startswith("<SkillPriorityMatrix"):
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
    lines = ["## Skill priorities"]
    for prop, items in MATRIX_PROP.findall(block):
        lines += ["", f"**{labels.get(prop, prop.title())}**", ""]
        lines += [f"- {item}" for item in json.loads(items)]
    return lines


def _tidy(text: str) -> str:
    """Collapse runs of blank lines left behind by removed tags."""
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"


def curate_file(path: Path, root: Path) -> Curated:
    meta, body = split_front_matter(path.read_text())
    rel = path.relative_to(root).as_posix()
    kind = {"lessons": "lesson", "insights": "insight", "roadmaps": "roadmap"}[rel.split("/")[0]]
    topic = meta.get("track") or meta.get("category") or "roadmaps"
    item = Curated(
        source=rel,
        kind=kind,
        topic=topic,
        slug=meta.get("slug") or path.stem,
        title=meta["title"],
        access="free" if meta.get("isFreePreview") else "paid",
    )
    text, warnings = mdx_to_markdown(body)
    item.flags += warnings
    if re.search(r"^> ", text, re.M):
        item.flags.append("has blockquote: check attribution")

    tags = meta.get("tags") or [t for t in (meta.get("track"), meta.get("stage")) if t]
    level = LEVELS.get(meta.get("difficulty", ""), meta.get("depth") or "all")
    head = {"title": item.title, "topic": topic, "kind": kind, "level": level, "tags": tags}
    item.markdown = "---\n" + yaml.safe_dump(head, sort_keys=False) + "---\n\n" + text

    if meta.get("sourceType") in THIRD_PARTY:
        item.decision, item.reason = "local-only", "built from third-party posts; review first"
    elif item.access == "paid":
        item.decision, item.reason = "local-only", "paid lesson; kept out of the public repo"
    else:
        item.reason = "free"
    return item


def curate(root: Path) -> list[Curated]:
    items = [curate_file(p, root) for p in sorted(root.rglob("*.mdx"))]
    seen: dict[str, str] = {}
    for item in items:
        body = item.markdown.split("---\n", 2)[2]
        words = len(body.split())
        digest = hashlib.sha256(" ".join(body.split()).lower().encode()).hexdigest()
        if words < MIN_WORDS:
            item.decision, item.reason = "dropped", f"stub ({words} words)"
        elif digest in seen or item.out_path in seen.values():
            original = seen.get(digest, item.out_path)
            item.decision, item.reason = "dropped", f"duplicate of {original}"
        else:
            seen[digest] = item.source
    return items


def write_corpus(items: list[Curated], out_dir: Path) -> None:
    for item in items:
        if item.decision == "dropped":
            continue
        target = out_dir / item.out_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(item.markdown)


def report(items: list[Curated]) -> str:
    counts: dict[str, int] = {}
    for item in items:
        counts[item.decision] = counts.get(item.decision, 0) + 1
    lines = [
        "# Curation report",
        "",
        "Generated by `cairnly curate`. Source: GradStack lessons (owned by the author).",
        "",
        "Rules: MDX components become plain markdown sections; front matter is normalized",
        "to title, topic, kind, level and tags; free lessons and roadmaps are public; paid",
        "lessons and insights built from third-party posts stay local-only (git-ignored);",
        f"stubs under {MIN_WORDS} words and duplicates are dropped.",
        "",
        "| Decision | Files |",
        "|---|---|",
        *[f"| {k} | {v} |" for k, v in sorted(counts.items())],
        "",
        "| Source | Kind | Topic | Decision | Reason | Flags |",
        "|---|---|---|---|---|---|",
    ]
    for item in items:
        cells = [item.source, item.kind, item.topic, item.decision, item.reason,
                 "; ".join(item.flags)]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"
