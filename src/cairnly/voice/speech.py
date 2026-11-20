"""What the bot says, and how a written answer becomes speech.

Answers are written for the screen: markdown, code blocks, tables, links and [n] citation
markers. Read aloud, those are noise, so SpeechChunker turns the answer's token stream into
plain sentences as the tokens arrive: code blocks and tables are left out (one short line says
the written answer has a code example), links keep their words, markers and URLs go. Each
sentence goes to text to speech as soon as it is complete, so the bot starts talking long before
the answer is finished.

Also here: the bot's fixed lines, and checks on what the caller said: a goodbye, the bot's own
words heard back through the caller's speakers (echo), and Whisper repeating its vocabulary hint
as if someone had said it.
"""

import re
from collections.abc import Iterator, Sequence

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


ECHO_SHARE = 0.7  # this much of what was heard, in order, the bot just said: its own echo
ECHO_WORDS = 400  # compare with at most the bot's last this many words


def _in_order(heard: list[str], said: list[str]) -> int:
    """How many of the heard words appear in what was said, in the same order (the longest
    common subsequence of the two word lists)."""
    row = [0] * (len(said) + 1)
    for word in heard:
        diagonal = 0
        for j, spoken in enumerate(said, start=1):
            above = row[j]
            row[j] = diagonal + 1 if word == spoken else max(row[j], row[j - 1])
            diagonal = above
    return row[-1]


def is_echo(text: str, said: Sequence[str], share: float = ECHO_SHARE) -> bool:
    """The caller's microphone picked up the bot's own voice: most of the words heard are, in
    order, words the bot just said. `said` is what the bot said lately, oldest first. A caller
    who talks over the bot with words of their own ("wait, what about LoRA?") is not echo."""
    heard = _words(text)
    spoken = [w for line in said for w in _words(line)][-ECHO_WORDS:]
    if not heard or not spoken:
        return False
    return _in_order(heard, spoken) / len(heard) >= share


def is_greeting_echo(text: str, greeting: str = GREETING, share: float = ECHO_SHARE) -> bool:
    """The greeting heard back: echo of the greeting, two words or more."""
    return len(_words(text)) >= 2 and is_echo(text, [greeting], share)


# -- Whisper's vocabulary hint, heard as speech ------------------------------------------------

MIN_HINT_RUN = 3  # this many hint terms in a row, with only punctuation between, is no question
HINT_GAP = re.compile(r"[\s,.;:!?-]*")
TOKEN = re.compile(r"[A-Za-z0-9'’]+")


def _norm(word: str) -> str:
    """Lowercase, and singular enough to match "LLMs" with "LLM" and "evals" with "eval"."""
    word = word.lower().replace("’", "'").removesuffix("'s")
    return word[:-1] if len(word) > 3 and word.endswith("s") else word


def drop_hint_echo(text: str, hint: str) -> str:
    """Remove Whisper's echo of the vocabulary hint it was given.

    Speech to text gets a hint ("RAG, LLM, LoRA, ..."; formerly a sentence with a colon before
    the terms) so it spells the course's words right. On a pause or a quiet start it sometimes
    writes the hint itself into the transcript, once or several times. Removed: the sentence
    before the colon, and every run of MIN_HINT_RUN or more hint terms with only punctuation
    between them, except a single term in such a run that is not part of the hint's own order
    (in "What is? RAG RAG, LLMs, embeddings..." the first RAG is the caller's). A caller who
    uses a term or two ("What is RAG?", "RAG or fine-tuning?") is left alone.
    """
    preamble, _, listed = hint.rpartition(":")
    terms = [tuple(_norm(w) for w in TOKEN.findall(t)) for t in listed.split(",")]
    terms = sorted((p for p in enumerate(terms) if p[1]), key=lambda p: -len(p[1]))
    tokens = list(TOKEN.finditer(text))
    words = [_norm(m.group()) for m in tokens]

    def joined(a: int, b: int) -> bool:  # only punctuation between token a and token b
        return HINT_GAP.fullmatch(text[tokens[a].end():tokens[b].start()]) is not None

    def matches(i: int, phrase: tuple[str, ...]) -> bool:
        n = len(phrase)
        return (tuple(words[i:i + n]) == phrase
                and all(joined(k, k + 1) for k in range(i, i + n - 1)))

    cut: set[int] = set()
    lead = tuple(_norm(w) for w in TOKEN.findall(preamble))
    for i in range(len(tokens)):
        if lead and matches(i, lead):
            cut.update(range(i, i + len(lead)))

    found: list[tuple[int, int, int]] = []  # (term index, first token, token after it)
    i = 0
    while i < len(tokens):
        term = next(((t, len(p)) for t, p in terms if i not in cut and matches(i, p)), None)
        if term is None:
            i += 1
            continue
        found.append((term[0], i, i + term[1]))
        i += term[1]

    runs: list[list[tuple[int, int, int]]] = []
    for hit in found:
        last = runs[-1][-1] if runs else None
        if last is not None and last[2] == hit[1] and joined(hit[1] - 1, hit[1]):
            runs[-1].append(hit)
        else:
            runs.append([hit])
    for run in runs:
        if len(run) < MIN_HINT_RUN:
            continue
        pieces: list[list[tuple[int, int, int]]] = []  # parts that follow the hint's order
        for hit in run:
            if pieces and hit[0] == pieces[-1][-1][0] + 1:
                pieces[-1].append(hit)
            else:
                pieces.append([hit])
        kept: set[int] = set()
        for piece in pieces:
            if len(piece) == 1 and piece[0][0] not in kept:
                kept.add(piece[0][0])
                continue
            for _, first, after in piece:
                cut.update(range(first, after))

    if not cut:
        return text
    out = [text[:tokens[0].start()] if tokens else text]
    for k, token in enumerate(tokens):
        gap = text[token.end():tokens[k + 1].start() if k + 1 < len(tokens) else len(text)]
        if k not in cut:
            out.append(token.group() + gap)
        elif k + 1 >= len(tokens) or k + 1 not in cut:  # keep where a sentence ended
            end = re.search(r"[.!?]", gap)
            out.append(f"{end.group()} " if end else " ")
    clean_text = re.sub(r"\s+([,.;:!?])", r"\1", "".join(out))
    clean_text = re.sub(r"([,.;:!?])(?:\s*[,.;:!?])+", r"\1", clean_text)
    clean_text = re.sub(r"\s+", " ", re.sub(r"^[\s,.;:!?-]+", "", clean_text)).strip()
    return clean_text if re.search(r"[A-Za-z0-9]", clean_text) else ""


def sentences(text: str) -> Iterator[str]:
    """Convenience for tests and the benchmark: speakable sentences of a finished text."""
    yield from speakable(text)
