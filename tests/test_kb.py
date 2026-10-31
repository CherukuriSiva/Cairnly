import pytest

from cairnly.kb import get_kb, load_kbs, load_prompt


def test_repo_kbs_file_is_valid_and_every_prompt_exists():
    kbs = load_kbs()
    assert set(kbs) == {"lessons"}
    for kb in kbs.values():
        assert 0 < kb.min_score < 1
        assert load_prompt(kb.prompt)  # raises if the prompt file is missing


def test_unknown_kb_names_the_known_ones():
    with pytest.raises(KeyError, match="known: lessons"):
        get_kb("nope")
    assert get_kb("lessons").path == "content"
