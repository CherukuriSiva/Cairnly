from pathlib import Path

import yaml

from cairnly.curate import curate, mdx_to_markdown, report, write_corpus

WORDS = " ".join(["word"] * 200)


def _lesson(root: Path, rel: str, free: bool = True, body: str = WORDS, **extra) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {"slug": path.stem, "title": path.stem.title(), "track": "ai-engineering",
            "stage": "foundations", "difficulty": "easy", "isFreePreview": free, **extra}
    path.write_text("---\n" + yaml.safe_dump(meta) + "---\n\n<Body>\n" + body + "\n</Body>\n")


def test_sections_become_headings_and_wrappers_vanish():
    md, warnings = mdx_to_markdown(
        "<WhyThisMatters>\nBecause.\n</WhyThisMatters>\n\n"
        "<Body>\n## Idea\nText\n</Body>\n<SourceNote />\n"
    )
    assert md == "## Why this matters\nBecause.\n\n## Idea\nText\n"
    assert warnings == []


def test_code_fences_are_untouched():
    body = "<Code>\n```tsx\n<PageShell>\n  <Body />\n</PageShell>\n```\n</Code>\n"
    md, warnings = mdx_to_markdown(body)
    assert "<PageShell>" in md and "<Body />" in md
    assert "<Code>" not in md
    assert warnings == []


def test_roadmap_phase_and_skill_matrix():
    md, _ = mdx_to_markdown(
        '<RoadmapPhase title="Month 1" duration="4 weeks">\n- learn\n</RoadmapPhase>\n'
        '<SkillPriorityMatrix\n  now={["Python"]}\n  ignore={["Hype"]}\n/>\n'
    )
    assert "## Month 1 (4 weeks)" in md
    assert "**Now**\n\n- Python" in md and "**Ignore for now**\n\n- Hype" in md


def test_unknown_component_is_flagged_not_dropped():
    md, warnings = mdx_to_markdown("<Mystery>\ntext\n</Mystery>\n")
    assert "<Mystery>" in md
    assert warnings == ["unknown component <Mystery>"]


def test_decisions_free_paid_thirdparty_stub_duplicate(tmp_path):
    src = tmp_path / "content"
    _lesson(src, "lessons/ai-engineering/free.mdx")
    _lesson(src, "lessons/ai-engineering/paid.mdx", free=False, body=WORDS + " paid")
    _lesson(src, "lessons/ai-engineering/stub.mdx", body="too short")
    _lesson(src, "lessons/ai-engineering/copy.mdx")  # same body as free.mdx
    _lesson(src, "insights/ai-engineering/post.mdx", body=WORDS + " post",
            sourceType="linkedin", category="ai-engineering")

    items = {i.source.split("/")[-1]: i for i in curate(src)}

    assert items["free.mdx"].decision == "public" or items["copy.mdx"].decision == "public"
    dropped = {k: i.reason for k, i in items.items() if i.decision == "dropped"}
    assert dropped["stub.mdx"].startswith("stub")
    assert "duplicate" in next(r for k, r in dropped.items() if k in ("free.mdx", "copy.mdx"))
    assert items["paid.mdx"].decision == "local-only"
    assert items["post.mdx"].decision == "local-only"
    assert "third-party" in items["post.mdx"].reason


def test_write_corpus_splits_public_and_private_and_report_lists_all(tmp_path):
    src = tmp_path / "content"
    _lesson(src, "lessons/ai-engineering/free.mdx")
    _lesson(src, "lessons/ai-engineering/paid.mdx", free=False, body=WORDS + " paid")
    items = curate(src)

    write_corpus(items, tmp_path / "corpus")

    public = tmp_path / "corpus/public/lessons/ai-engineering/free.md"
    assert public.is_file()
    assert (tmp_path / "corpus/private/lessons/ai-engineering/paid.md").is_file()
    head = yaml.safe_load(public.read_text().split("---\n")[1])
    assert head == {"title": "Free", "topic": "ai-engineering", "kind": "lesson",
                    "level": "beginner", "tags": ["ai-engineering", "foundations"]}
    text = report(items)
    assert "lessons/ai-engineering/free.mdx" in text and "| local-only | 1 |" in text
