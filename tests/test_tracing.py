from cairnly import tracing
from cairnly.answer import answer
from cairnly.kb import KnowledgeBase
from cairnly.search import Hit, SearchResult


class FakeObservation:
    def __init__(self, log, name, kind):
        self.log, self.name = log, name
        log.append(("start", kind, name))

    def start_span(self, name, **fields):
        return FakeObservation(self.log, name, "span")

    def start_generation(self, name, **fields):
        self.log.append(("model", name, fields.get("model")))
        return FakeObservation(self.log, name, "generation")

    def update(self, **fields):
        if "completion_start_time" in fields:
            self.log.append(("first_token", self.name))

    def update_trace(self, **fields):
        self.log.append(("trace", fields["name"], tuple(fields["tags"])))

    def end(self):
        self.log.append(("end", self.name))


class FakeLangfuse:
    def __init__(self):
        self.log = []

    def start_span(self, name, **fields):
        return FakeObservation(self.log, name, "root")


class FakeLLM:
    name = "fake/llm"

    def stream(self, system, prompt):
        yield "Yes "
        yield "[1]."


KB = KnowledgeBase("lessons", "Lessons", "corpus", 0.5, "answer-v1")
HIT = Hit(1, "T", "a.md", "S", 1, 2, "text")


def test_tracing_is_a_no_op_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    tracing.client.cache_clear()
    assert tracing.start_trace("ask") is tracing.NO_SPAN
    tracing.flush()  # must not raise


def test_answer_records_retrieve_and_generate_under_one_trace(monkeypatch):
    fake = FakeLangfuse()
    monkeypatch.setattr(tracing, "client", lambda: fake)

    events = list(answer("q", lambda q: SearchResult([HIT], 0.9), FakeLLM(), KB))

    assert events[-1]["type"] == "done"
    assert fake.log == [
        ("start", "root", "ask"), ("trace", "ask", ("lessons",)),
        ("start", "span", "retrieve"), ("end", "retrieve"),
        ("model", "generate", "fake/llm"), ("start", "generation", "generate"),
        ("first_token", "generate"), ("end", "generate"),
        ("end", "ask"),
    ]


def test_follow_up_adds_a_rewrite_step_before_retrieve(monkeypatch):
    fake = FakeLangfuse()
    monkeypatch.setattr(tracing, "client", lambda: fake)
    history = [{"question": "What is RAG?", "answer": "Retrieval then generation."}]

    list(answer("And how do I test it?", lambda q: SearchResult([HIT], 0.9), FakeLLM(), KB,
                history=history))

    assert fake.log[:6] == [
        ("start", "root", "ask"), ("trace", "ask", ("lessons",)),
        ("model", "rewrite", "fake/llm"), ("start", "generation", "rewrite"), ("end", "rewrite"),
        ("start", "span", "retrieve"),
    ]


def test_refused_answers_have_no_generation(monkeypatch):
    fake = FakeLangfuse()
    monkeypatch.setattr(tracing, "client", lambda: fake)

    list(answer("q", lambda q: SearchResult([HIT], 0.1), FakeLLM(), KB))

    assert not any(entry[0] == "model" for entry in fake.log)
