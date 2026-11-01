"""Knowledge-base registry (kbs.yaml) and versioned prompts (prompts/<version>.md).

A knowledge base is stored as the `source` label on its documents, so search can be limited
to one corpus with a WHERE clause. Prompts live in files with a version in the name: changing
a prompt means adding a new file, and every answer reports which version produced it.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
KBS_FILE = ROOT / "kbs.yaml"
PROMPTS_DIR = ROOT / "prompts"


@dataclass(frozen=True)
class KnowledgeBase:
    name: str
    title: str
    path: str
    min_score: float
    prompt: str
    notice: str = ""
    rerank: bool = False  # cross-encoder second stage (needs `uv sync --extra rerank`)
    questions: str = ""  # folder of written eval questions (*.jsonl), relative to the repo root


@lru_cache
def load_kbs(path: Path = KBS_FILE) -> dict[str, KnowledgeBase]:
    raw = yaml.safe_load(path.read_text()) or {}
    return {name: KnowledgeBase(name=name, **cfg) for name, cfg in raw.items()}


def get_kb(name: str) -> KnowledgeBase:
    kbs = load_kbs()
    if name not in kbs:
        raise KeyError(f"unknown knowledge base {name!r}; known: {', '.join(kbs)}")
    return kbs[name]


@lru_cache
def load_prompt(version: str, prompts_dir: Path = PROMPTS_DIR) -> str:
    return (prompts_dir / f"{version}.md").read_text().strip()
