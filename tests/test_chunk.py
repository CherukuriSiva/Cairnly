from cairnly.chunk import chunk_markdown


def test_one_chunk_per_section_with_heading_trail():
    body = "Intro line.\n\n## Idea\nText A\n\n### Detail\nText B\n\n## Next\nText C\n"
    chunks = chunk_markdown(body)

    assert [c.trail for c in chunks] == ["", "Idea", "Idea > Detail", "Next"]
    assert chunks[2].text == "### Detail\nText B"
    assert (chunks[2].start_line, chunks[2].end_line) == (6, 8)


def test_heading_inside_code_fence_is_not_a_section():
    body = "## Real\n```bash\n# not a heading\necho hi\n```\n"
    chunks = chunk_markdown(body)

    assert len(chunks) == 1 and chunks[0].trail == "Real"
    assert "# not a heading" in chunks[0].text


def test_long_section_splits_at_blank_lines_but_never_inside_a_fence():
    para = "word " * 60
    fence = "```\n" + "\n".join(["code"] * 5) + "\n\n" + "\n".join(["more"] * 5) + "\n```"
    body = "## Big\n" + "\n\n".join([para] * 6) + "\n\n" + fence + "\n"
    chunks = chunk_markdown(body, max_chars=700)

    assert len(chunks) > 1
    assert all(c.trail == "Big" for c in chunks)
    assert all(c.text.count("```") in (0, 2) for c in chunks)


def test_heading_only_sections_are_skipped():
    assert [c.trail for c in chunk_markdown("## Empty\n\n## Full\ntext\n")] == ["Full"]
