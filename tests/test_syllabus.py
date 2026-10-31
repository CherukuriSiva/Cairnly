from cairnly.kb import ROOT
from cairnly.syllabus import load_syllabus, track_ids


def test_tracks_in_order():
    assert track_ids() == [
        "ml-foundations", "ai-engineering", "ai-systems", "dsa", "full-stack", "career"]


def test_every_listed_lesson_has_a_file_in_its_track():
    for track in load_syllabus()["tracks"]:
        for module in track["modules"]:
            assert module["title"]
            for slug in module["lessons"]:
                assert (ROOT / "content" / "lessons" / track["id"] / f"{slug}.mdx").is_file()
