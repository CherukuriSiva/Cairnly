"""What the bot says, and how a written answer becomes speech.

Answers are written for the screen: markdown, code blocks, tables, links and [n] citation
markers. Read aloud, those are noise, so SpeechChunker turns the answer's token stream into
plain sentences as the tokens arrive: code blocks and tables are left out (one short line says
the written answer has a code example), links keep their words, markers and URLs go. Each
sentence goes to text to speech as soon as it is complete, so the bot starts talking long before
the answer is finished.

Also here: the bot's fixed lines, and two checks on what the caller said (a goodbye, and the
bot's own greeting heard back through the caller's speakers).
"""

import re
from collections.abc import Iterator

GREETING = "Hi, I'm Cairnly. Ask me anything about the AI engineering lessons."
HOLDING = "Let me check the lessons."
FAREWELL = "Thanks for calling. Goodbye!"
IDLE = "I haven't heard anything for a while, so I'll hang up now. Goodbye!"
TIME_UP = "We're out of time for this call. Goodbye!"
CODE_NOTE = "There's a code example in the written answer."
TOO_MANY = "You've asked a lot of questions. Please wait a minute and try again."
BUSY = "The answer model is busy right now. Please ask again in a few seconds."
GONE = "This conversation was cleared. Please hang up and start a new chat."
TROUBLE = "Sorry, something went wrong while I was looking that up. Please ask again."

FENCE = "```"
ABBREVIATIONS = ("e.g.", "i.e.", "vs.", "etc.", "approx.", "Dr.", "Mr.", "Ms.")
SENTENCE_END = re.compile(r"[.!?]+[\"')\]]*(?=\s)")
MIN_SENTENCE_CHARS = 12  # shorter pieces wait for the next sentence, so speech is not choppy

FAREWELLS = ("goodbye", "good bye", "bye", "bye bye", "see you", "see ya", "that's all",
             "that is all", "hang up", "end the call", "end call", "stop the call", "i'm done",
             "i am done", "we're done", "talk later", "talk to you later")
MAX_FAREWELL_WORDS = 8


def clean(text: str) -> str:
    """One piece of markdown as plain words for speech ("" when nothing speakable is left)."""
    text = re.sub(r"\[([^\]]+)\]\((?:[^)\s]+)\)", r"\1", text)  # [words](url) -> words
    text = re.sub(r"\s*\[\d+(?:\s*,\s*\d+)*\]", "", text)  # [1], [2, 3]
    text = re.sub(r"(?:https?://|www\.)[^\s)]*[^\s).,;:!?]", "the link", text)
    text = re.sub(r"<[^>]+>", "", text)  # stray html
    text = re.sub(r"^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"(?<!\w)[*_](\S[^*_]*?)[*_](?!\w)", r"\1", text)
    text = text.replace("`", "").replace("*", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text if re.search(r"[A-Za-z0-9]", text) else ""


class SpeechChunker:
    """Feed answer tokens in, take speakable sentences out.

    Text inside ``` fences and table rows (lines starting with "|") are dropped; the first
    code block in an answer is replaced by CODE_NOTE. `flush()` returns what is left once the
    answer ends.
    """

    def __init__(self) -> None:
        self.buffer = ""  # text not yet looked at
        self.sentence = ""  # outside fences, waiting for a sentence end
        self.in_fence = False
        self.noted_code = False

    def feed(self, text: str) -> list[str]:
        self.buffer += text
        out: list[str] = []
        while self.buffer:
            if self.in_fence:
                end = self.buffer.find(FENCE)
                if end < 0:  # keep a possible partial closing fence
                    self.buffer = self.buffer[-(len(FENCE) - 1):]
                    break
                rest = self.buffer[end + len(FENCE):]  # the rest of the closing fence line goes
                self.buffer = rest[rest.find("\n") + 1:] if "\n" in rest else rest
                self.in_fence = False
                if not self.noted_code:
                    self.noted_code = True
                    out.append(CODE_NOTE)
                continue
            start = self.buffer.find(FENCE)
            if start >= 0:
                self._take(self.buffer[:start], out, final=True)
                self.buffer = self.buffer[start + len(FENCE):]
                self.in_fence = True
                continue
            # No fence: everything up to the last complete line can be read; a partial last
            # line too, unless it may still become a fence or a table row.
            newline = self.buffer.rfind("\n")
            head, tail = self.buffer[:newline + 1], self.buffer[newline + 1:]
            if tail.lstrip().startswith(("|", "`")):
                self._take(head, out)
                self.buffer = tail
                break
            self._take(self.buffer, out)
            self.buffer = ""
        return out

    def flush(self) -> list[str]:
        out: list[str] = []
        if not self.in_fence and self.buffer:
            self._take(self.buffer, out, final=True)
        self.buffer = ""
        if self.sentence:
            spoken = clean(self.sentence)
            if spoken:
                out.append(spoken)
            self.sentence = ""
        return out

    def _take(self, text: str, out: list[str], final: bool = False) -> None:
        """Add text outside fences; emit every complete sentence in it."""
        lines = text.split("\n")
        for i, line in enumerate(lines):
            last = i == len(lines) - 1
            if line.lstrip().startswith("|"):
                continue  # a table row is not read aloud
            self.sentence += line
            if not last:
                self.sentence += "\n"
                if line.strip() == "" or re.match(r"\s*(?:#{1,6}|[-*+]|\d+[.)])\s", line):
                    self._emit_all(out, force=True)  # a paragraph, heading or list item ends
                    continue
            self._emit_all(out)
        if final:
            self._emit_all(out, force=True)

    def _emit_all(self, out: list[str], force: bool = False) -> None:
        while True:
            cut = self._sentence_end()
            if cut is None:
                break
            piece, self.sentence = self.sentence[:cut], self.sentence[cut:]
            spoken = clean(piece)
            if spoken:
                out.append(spoken)
        if force:
            spoken = clean(self.sentence)
            if spoken:
                out.append(spoken)
            self.sentence = ""

    def _sentence_end(self) -> int | None:
        for match in SENTENCE_END.finditer(self.sentence):
            end = match.end()
            before = self.sentence[:end]
            if before.rstrip().endswith(ABBREVIATIONS):
                continue
            if len(clean(before)) < MIN_SENTENCE_CHARS:
                continue
            return end
        return None


def speakable(markdown: str) -> list[str]:
    """A whole text (a refusal, a withdrawal message) as speakable sentences."""
    chunker = SpeechChunker()
    return chunker.feed(markdown) + chunker.flush()


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))


def is_farewell(text: str) -> bool:
    """A short goodbye ("bye", "that's all, thanks") ends the call. Long sentences that merely
    contain such a word ("what does goodbye mean in...") are questions."""
    words = _words(text)
    if not words or len(words) > MAX_FAREWELL_WORDS:
        return False
    joined = f" {' '.join(words)} "
    return any(f" {phrase} " in joined for phrase in FAREWELLS)


def is_greeting_echo(text: str, greeting: str = GREETING, share: float = 0.7) -> bool:
    """The caller's microphone picked up the bot's own greeting: most of the words heard are
    greeting words. Only checked in the first seconds of a call."""
    heard = _words(text)
    if len(heard) < 2:
        return False
    said = set(_words(greeting))
    return sum(w in said for w in heard) / len(heard) >= share


def sentences(text: str) -> Iterator[str]:
    """Convenience for tests and the benchmark: speakable sentences of a finished text."""
    yield from speakable(text)
