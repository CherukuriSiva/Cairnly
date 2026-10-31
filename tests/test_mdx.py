from cairnly.kb import ROOT
from cairnly.mdx import mdx_to_markdown, section_titles, split_front_matter


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
    assert "## Skill priorities" in md
    assert "**Now**\n\n- Python" in md and "**Ignore for now**\n\n- Hype" in md


def test_unknown_component_is_flagged_not_dropped():
    md, warnings = mdx_to_markdown("<Mystery>\ntext\n</Mystery>\n")
    assert "<Mystery>" in md
    assert warnings == ["unknown component <Mystery>"]


def test_book_note_with_attribute_opens_a_section():
    md, warnings = mdx_to_markdown(
        '<Body>\nx\n</Body>\n\n<BookNote chapter="3">\n\nOur note.\n</BookNote>\n'
    )
    assert md == "x\n\n## From AI Engineering (Chip Huyen)\n\nOur note.\n"
    assert warnings == []


def test_attributes_on_other_tags_and_self_closing_tags():
    md, warnings = mdx_to_markdown('<Diagram kind="flow">\nA --> B\n</Diagram>\n<SourceNote />\n')
    assert md == "A --> B\n"
    assert warnings == []


def test_titles_come_from_sections_json():
    titles = section_titles()
    assert titles["BookNote"] == "From AI Engineering (Chip Huyen)"
    assert titles["SkillPriorityMatrix"] == "Skill priorities"
    assert titles["MiniQuiz"] == "Quick quiz"


def test_every_content_file_converts_without_warnings():
    files = sorted((ROOT / "content").rglob("*.mdx"))
    assert len(files) == 162
    problems = {}
    for path in files:
        meta, body = split_front_matter(path.read_text())
        _, warnings = mdx_to_markdown(body)
        if warnings or not meta.get("title") or not meta.get("slug"):
            problems[path.relative_to(ROOT).as_posix()] = warnings or ["missing title/slug"]
    assert problems == {}
