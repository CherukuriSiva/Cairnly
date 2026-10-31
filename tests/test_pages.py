import json
from pathlib import Path

import pytest

from cairnly.mdx import mdx_to_markdown
from cairnly.pages import anchor_at, heading_anchors, page_url, slugify, unique_slugs

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "anchors.json").read_text())


@pytest.mark.parametrize("case", FIXTURE, ids=[c["name"] for c in FIXTURE])
def test_anchor_fixture_parity(case):
    markdown, warnings = mdx_to_markdown(case["mdx"])
    assert warnings == []
    assert [a for _, a in heading_anchors(markdown)] == case["anchors"]


def test_slugify_rules():
    assert slugify("Run it with `asyncio.gather`") == "run-it-with-asyncio-gather"
    assert slugify("See [the docs](https://x.y/z) now") == "see-the-docs-now"
    assert slugify("  --Hello,  World!--  ") == "hello-world"
    assert slugify("!!!") == "section"


def test_unique_slugs_skip_used_values():
    assert unique_slugs(["A", "A", "A 1", "A"]) == ["a", "a-1", "a-1-1", "a-2"]


def test_heading_anchors_give_line_numbers():
    md = "intro\n\n## One\ntext\n\n### Two\nmore\n"
    assert heading_anchors(md) == [(3, "one"), (6, "two")]


def test_anchor_at_picks_the_last_heading_at_or_before_a_line():
    anchors = [(3, "one"), (6, "two")]
    assert anchor_at(anchors, 1) == ""
    assert anchor_at(anchors, 3) == "one"
    assert anchor_at(anchors, 5) == "one"
    assert anchor_at(anchors, 6) == "two"
    assert anchor_at([], 4) == ""


def test_page_url_per_kind():
    lesson = {"slug": "what-is-rag", "track": "ai-engineering"}
    assert page_url("lessons/ai-engineering/what-is-rag.mdx", lesson, "why-this-matters") == (
        "/ai-engineering/what-is-rag#why-this-matters")
    assert page_url("lessons/ai-engineering/what-is-rag.mdx", lesson) == (
        "/ai-engineering/what-is-rag")
    assert page_url("roadmaps/ai-engineer-technical-path.mdx",
                    {"slug": "ai-engineer-technical-path"}, "x") == (
        "/roadmap/ai-engineer-technical-path#x")
    assert page_url("insights/career/two-types-of-ai-engineer.mdx",
                    {"slug": "two-types-of-ai-engineer", "category": "career"}) == (
        "/insights/two-types-of-ai-engineer")
    assert page_url("passage-17", {"source_title": "A paper"}, "x") == ""
