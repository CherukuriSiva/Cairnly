"""Guardrails around the model: a rules-based input check and an output check.

Input check: named, case-insensitive regex rules catch the common attacks on a public chat:
- injection: commands that try to replace the app's instructions ("ignore previous
  instructions", "new instructions:", "you are now ...")
- jailbreak: role-play that removes the rules (DAN, "developer mode", "you have no rules")
- prompt_extraction: asking the assistant to reveal its own system prompt
- junk: input that is not a question (no letters, one character repeated, huge blobs,
  link spam)

The site TEACHES prompt injection, so asking ABOUT an attack must pass: "What is a jailbreak?"
or "What does 'ignore previous instructions' mean?" are good questions. The rules therefore
match commanding forms (at the start of a sentence, or addressed to "you"/"your"), not topic
words. A rules list is cheap, fast, explainable and testable; its miss and wrong-block rates
are measured on evals/redteam.jsonl in CI (ADR 0014). It is one layer, not the only one: the
answer prompt also treats sources as data, and the output check below runs on every answer.

Output check:
- leak: the answer repeats 8 or more words in a row from the system prompt, so the answer is
  withdrawn
- uncited: a normal answer with no [n] marker is flagged (not withdrawn) so the reader knows
  to check the sources
"""

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

GUARD_REFUSAL = ("I can only help with questions about the AI engineering lessons, and I can't "
                 "follow instructions that try to change how I work.")
LEAK_WINDOW = 8  # words in a row shared with the system prompt that count as a leak
MAX_URLS = 5
MAX_TOKEN_CHARS = 200  # one whitespace-free token longer than this is a blob, not a question
MAX_REPEAT = 30  # one character repeated this many times

# Where a command can start: the start of the text or of a sentence, after a joining word
# ("... and ignore ..."), or after "please". Asking about a phrase mid-sentence does not match.
_START = r"(?:^|[.!?\n]\s*|\b(?:and|then|now|so|but|also|please|just|first|instead),?\s+)" \
         r"[\"'“‘(\[]?\s*"
_OVERRIDE = r"(?:ignore|disregard|forget|override|bypass|skip|drop|discard|abandon)"
_DETERMINERS = r"(?:(?:all|any|every|each|of|the|your|my|these|those|this|its|previous|prior|" \
               r"above|earlier|preceding|former|original|initial|system|old|existing|safety|" \
               r"current)\s+)*"
_RULE_WORDS = r"(?:instructions?|rules?|prompts?|directions?|directives?|guidelines?|" \
              r"guardrails?|constraints?|programming|policies|policy|restrictions?|context)"
_RESTRICTIONS = r"(?:restrictions?|rules?|limits?|limitations?|filters?|guidelines?|" \
                r"guardrails?|censorship|safety|boundaries|constraints?|morals?|ethics)"
_REVEAL = r"(?:show|print|reveal|repeat|output|display|give|tell|list|share|dump|leak|paste|" \
          r"spell|recite|translate|summari[sz]e|paraphrase|encode|copy|expose|return|state)"
_PROMPT_WORDS = r"(?:system\s+prompt|prompt|instructions|rules|guidelines|directives|" \
                r"system\s+message|initial\s+message|configuration|pre-?prompt)"

RULES: dict[str, list[str]] = {
    "injection": [
        _START + _OVERRIDE + r"\s+" + _DETERMINERS + _RULE_WORDS + r"\b",
        r"\byou\s+(?:\w+\s+){0,3}?" + _OVERRIDE + r"\s+" + _DETERMINERS + _RULE_WORDS + r"\b",
        r"\b(?:new|updated|real|actual|revised)\s+(?:system\s+)?(?:instructions|rules|prompt)"
        r"\s*:",
        _START + r"you\s+are\s+now\b",
        r"\bfrom\s+now\s+on,?\s+(?:you|act|respond|answer|reply|only|always|never|ignore)\b",
        r"(?:^|\n)\s*(?:system|assistant|admin|developer)\s*(?:prompt\s*)?:",
        r"<\|?\s*(?:system|im_start|im_end|endoftext)",
        r"\[\s*(?:system|inst)\s*\]",
        # the same command in other languages
        r"\b(?:ignor[ae]\w*|olvida\w*|esque[cç]a\w*)\s+(?:todas\s+)?(?:las\s+|as\s+|tus\s+)?"
        r"(?:instrucciones|instru[cç][oõ]es|reglas|regras)",
        r"\b(?:ignore[sz]?|oublie[sz]?)\s+(?:toutes\s+)?(?:les\s+|tes\s+|vos\s+)?"
        r"(?:instructions|consignes|règles)",
        r"\b(?:ignorier\w*|vergiss\w*)\s+(?:alle\s+)?(?:\w+\s+)?(?:anweisungen|regeln|"
        r"instruktionen)",
        r"\bignora\w*\s+(?:tutte\s+)?(?:le\s+)?(?:istruzioni|regole)",
    ],
    "jailbreak": [
        r"\b(?:you\s+are|you're|act\s+as|become|pretend\s+to\s+be|roleplay\s+as|play)\s+"
        r"(?:now\s+)?(?:a\s+)?(?-i:DAN)\b",
        r"\b(?:enable|activate|enter|switch\s+to|turn\s+on|unlock|start)\s+(?:the\s+)?"
        r"(?:DAN|developer|dev|god|jailbreak|unrestricted|unfiltered|debug|admin|sudo)\s+mode\b",
        r"(?:^|[.!?\n]\s*)(?:DAN|developer|dev|god|jailbreak)\s+mode\s+"
        r"(?:enabled|on|activated|engaged)",
        r"\byou\s+(?:can|will|are\s+going\s+to|must|shall)\s+(?:now\s+)?do\s+anything\s+now\b",
        r"\b(?:pretend|imagine|act\s+as\s+if|assume|suppose)\s+(?:that\s+)?you\s+(?:have|had|"
        r"are\s+under|were\s+under)\s+no\s+" + _RESTRICTIONS,
        r"\byou\b[^.?!\n]{0,40}\bwithout\s+(?:any\s+)?(?:of\s+)?(?:your\s+)?(?:\w+\s+)?"
        + _RESTRICTIONS,
        r"(?:^|[.!?\n]\s*)(?:please\s+)?(?:answer|respond|reply|act|behave|write|speak|talk)"
        r"\b[^.?!\n]{0,40}\bwithout\s+(?:any\s+)?" + _RESTRICTIONS,
        r"\byou\s+(?:are|'re)\s+(?:now\s+)?(?:no\s+longer\s+(?:bound|restricted|limited|"
        r"required)|free\s+(?:of|from)\s+(?:all\s+|any\s+|your\s+)?" + _RESTRICTIONS + r")",
        r"\byou\s+(?:now\s+)?(?:have|has)\s+no\s+" + _RESTRICTIONS,
        r"\b(?:act|behave|respond|answer|reply|talk)\s+(?:as|like)\s+(?:an?\s+)?(?:\w+\s+)?"
        r"(?:unfiltered|uncensored|unrestricted|evil|amoral|jailbroken|rogue|unaligned)",
        r"\b(?:you\s+are|you're|become)\s+(?:now\s+)?(?:an?\s+)?(?:unfiltered|uncensored|"
        r"unrestricted|evil|amoral|jailbroken|rogue|unaligned)\b",
        r"\bstay\s+in\s+character\b",
    ],
    "prompt_extraction": [
        r"\b" + _REVEAL + r"\s+(?:me\s+|us\s+)?(?:back\s+)?(?:out\s+)?(?:all\s+of\s+|all\s+)?"
        r"your\s+(?:\w+\s+){0,2}?" + _PROMPT_WORDS + r"\b",
        _START + _REVEAL + r"\s+(?:me\s+|us\s+)?(?:the|this)\s+(?:\w+\s+){0,2}?"
        r"(?:system\s+prompt|system\s+message|hidden\s+prompt|initial\s+prompt|"
        r"prompt\s+above|instructions\s+above|instructions\s+you\s+were\s+given)\b",
        r"\byou\s+(?:\w+\s+){0,2}?" + _REVEAL + r"\s+(?:me\s+|us\s+)?(?:the|this)\s+"
        r"(?:\w+\s+){0,2}?(?:system\s+prompt|system\s+message|hidden\s+prompt|initial\s+prompt)\b",
        r"\bwhat\s+(?:are|were|is|was)\s+your\s+(?:\w+\s+){0,2}?(?:instructions|system\s+prompt|"
        r"prompt|rules|directives|guidelines)\b",
        r"\b(?:first|last|opening|exact)\s+(?:line|lines|sentence|words?|paragraph)\s+of\s+"
        r"(?:your|the\s+system)\s+(?:prompt|instructions|message)",
        r"\b(?:repeat|print|output|recite|copy)\s+(?:the\s+|all\s+)?(?:text|words|everything|"
        r"content)\s+(?:above|before|preceding)",
        r"\b(?:what|everything)\s+(?:was|is)\s+written\s+(?:above|before)\s+(?:this|my)",
        r"\bhow\s+(?:were|are)\s+you\s+(?:instructed|prompted|configured|programmed)\b",
    ],
}
_COMPILED = {rule: [re.compile(p, re.I) for p in patterns] for rule, patterns in RULES.items()}
_URL = re.compile(r"https?://|www\.", re.I)
_INVISIBLE = re.compile(r"[​-‏⁠﻿­]")


@dataclass(frozen=True)
class Verdict:
    blocked: bool
    rule: str | None = None


ALLOW = Verdict(False)


def normalize(text: str) -> str:
    """Undo cheap disguises: Unicode look-alike forms, invisible characters, extra spaces."""
    text = _INVISIBLE.sub("", unicodedata.normalize("NFKC", text))
    return re.sub(r"[ \t]+", " ", text).strip()


def is_junk(text: str) -> bool:
    letters = sum(ch.isalpha() for ch in text)
    return (letters < 2
            or re.search(rf"(.)\1{{{MAX_REPEAT - 1},}}", text) is not None
            or re.search(rf"\S{{{MAX_TOKEN_CHARS + 1},}}", text) is not None
            or len(_URL.findall(text)) > MAX_URLS)


def check_input(text: str) -> Verdict:
    """Block `text` when one of the rules matches; the verdict names the rule."""
    text = normalize(text)
    if is_junk(text):
        return Verdict(True, "junk")
    for rule, patterns in _COMPILED.items():
        if any(p.search(text) for p in patterns):
            return Verdict(True, rule)
    return ALLOW


def check_all(texts: Iterable[str]) -> Verdict:
    """The first blocking verdict among `texts`, or ALLOW."""
    for text in texts:
        verdict = check_input(text)
        if verdict.blocked:
            return verdict
    return ALLOW


# ---- output check ------------------------------------------------------------------------

_WORD = re.compile(r"[a-z0-9]+")


@lru_cache(maxsize=8)
def leak_windows(system_prompt: str) -> frozenset[tuple[str, ...]]:
    """Every run of LEAK_WINDOW words in the prompt (lowercased, punctuation dropped)."""
    words = _WORD.findall(system_prompt.lower())
    return frozenset(tuple(words[i:i + LEAK_WINDOW])
                     for i in range(len(words) - LEAK_WINDOW + 1))


class LeakDetector:
    """Watches a streamed answer for a run of words copied from the system prompt.

    Pieces can split a word ("Ci" + "te"), so the last word stays pending until a later piece
    (or `finish()`) completes it, and each call checks only the windows it completed.
    """

    def __init__(self, system_prompt: str):
        self.windows = leak_windows(system_prompt)
        self.words: list[str] = []
        self.pending = ""

    def feed(self, piece: str) -> bool:
        """Add a piece of the answer; True when the answer now leaks the prompt."""
        text = (self.pending + piece).lower()
        found = _WORD.findall(text)
        ends_mid_word = bool(found) and _WORD.fullmatch(text[-1:]) is not None
        self.pending = found.pop() if ends_mid_word else ""
        return self._add(found)

    def finish(self) -> bool:
        """The answer ended: the pending word is complete now."""
        last, self.pending = self.pending, ""
        return self._add([last] if last else [])

    def _add(self, new_words: list[str]) -> bool:
        start = max(0, len(self.words) - LEAK_WINDOW + 1)
        self.words += new_words
        return any(tuple(self.words[i:i + LEAK_WINDOW]) in self.windows
                   for i in range(start, len(self.words) - LEAK_WINDOW + 1))


def is_cited(answer_text: str) -> bool:
    return re.search(r"\[\d+\]", answer_text) is not None
