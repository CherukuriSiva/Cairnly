"""The syllabus (content/syllabus.yaml): tracks, modules and lesson order.

The web pages read the same file for navigation; the API uses it to validate a `track` scope.
"""

from functools import lru_cache
from pathlib import Path

import yaml

from cairnly.kb import ROOT

SYLLABUS_FILE = ROOT / "content" / "syllabus.yaml"


@lru_cache
def load_syllabus(path: Path = SYLLABUS_FILE) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def track_ids() -> list[str]:
    """Track ids in syllabus order, e.g. ["ml-foundations", "ai-engineering", ...]."""
    return [track["id"] for track in load_syllabus().get("tracks", [])]
