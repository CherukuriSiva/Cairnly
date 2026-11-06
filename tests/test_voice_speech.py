from cairnly.voice import speech
from cairnly.voice.speech import SpeechChunker, clean, is_farewell, is_greeting_echo, speakable

ANSWER = """RAG means **retrieval-augmented generation** [1]. It finds relevant text first, e.g. \
lesson sections, and then writes an answer from them [2, 3].

Here is the idea in code:

```python
hits = search(question)
answer = llm(question, hits)
```

| Step | What |
|---|---|
| 1 | Retrieve |

- Retrieve the top chunks.
- Generate with [citations](https://example.com/rag). More at https://example.com/x.
That is all"""


def stream(text: str, size: int) -> list[str]:
    chunker, out = SpeechChunker(), []
    for i in range(0, len(text), size):
        out += chunker.feed(text[i:i + size])
    return out + chunker.flush()


def test_answer_becomes_plain_sentences():
    assert speakable(ANSWER) == [
        "RAG means retrieval-augmented generation.",
        "It finds relevant text first, e.g. lesson sections, and then writes an answer from them.",
        "Here is the idea in code:",
        speech.CODE_NOTE,
        "Retrieve the top chunks.",
        "Generate with citations.",
        "More at the link.",
        "That is all",
    ]


def test_token_size_does_not_change_the_sentences():
    whole = speakable(ANSWER)
    for size in (1, 2, 3, 7, 50):
        assert stream(ANSWER, size) == whole


def test_first_sentence_is_ready_before_the_answer_ends():
    chunker = SpeechChunker()
    assert chunker.feed("Embeddings turn text into vectors [1]. They let") == [
        "Embeddings turn text into vectors."]
    assert chunker.flush() == ["They let"]


def test_short_pieces_wait_for_more_text():
    chunker = SpeechChunker()
    assert chunker.feed("Yes. ") == []
    assert chunker.feed("A vector index finds neighbours fast. ") == [
        "Yes. A vector index finds neighbours fast."]


def test_code_note_is_said_once_and_unclosed_code_is_dropped():
    text = "Look:\n```\na = 1\n```\nAnd:\n```\nb = 2\n```\nDone now.\n```\nnever closed"
    assert speakable(text) == ["Look:", speech.CODE_NOTE, "And:", "Done now."]


def test_clean_keeps_words_and_drops_marks():
    assert clean("## A *great* `tool` <b>here</b> [4]") == "A great tool here"
    assert clean("[1] | --- |") == ""


def test_farewells():
    for said in ("Bye!", "Okay, goodbye.", "That's all, thanks", "Please hang up",
                 "thank you, see you"):
        assert is_farewell(said), said
    for said in ("What is a byte pair encoding?", "", "Why does the model say goodbye at "
                 "the end of every single answer it writes?"):
        assert not is_farewell(said), said


def test_greeting_echo():
    assert is_greeting_echo("Ask me anything about the AI engineering lessons")
    assert is_greeting_echo("hi I'm Cairnly")
    assert not is_greeting_echo("What are the lessons about evals?")
    assert not is_greeting_echo("lessons")  # one word is not enough to tell
