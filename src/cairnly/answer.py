"""Answer a question from retrieved sources, streaming events a UI can render.

Event stream (one dict per event):
    {"type": "sources", "sources": [...]}   numbered like the [n] markers in the answer; each
                                            source has a page "url" ("" when it has no page)
    {"type": "token", "text": "..."}        answer text, piece by piece
    {"type": "retract", "message": "..."}   the output check withdrew the answer streamed so
                                            far; show the message instead (a done follows)
    {"type": "done", "refused": bool, "model": "...", "prompt_version": "...", "kb": "...",
     "top_similarity": 0.83, "query": "...",   query = what was searched
     "guard": "injection" | null,           the guard rule that refused, if any
     "uncited": bool}                       a normal answer with no [n] marker
    {"type": "error", "message": "..."}     a friendly message; no done follows

Guard: the question, every earlier question in `history` and the rewritten follow-up go
through the input rules (guard.py) before anything is searched; a match is refused with a
fixed message. Earlier answers are the app's own text and may quote attacks from the lessons,
so they are not checked.

Follow-ups: with earlier turns in `history`, the question is first rewritten into a standalone
one (rewrite.py), and search and the answer prompt use that.

Confidence gate: when even the best match is weakly similar, the corpus probably does not cover
the question. Refusing then is better than letting the model answer from its own memory with
citations that do not support it.

Time limits (wall clock, llm.time_limited): the model must send its first token within
FIRST_TOKEN_TIMEOUT_S (long enough for a cold GPU) and finish within ANSWER_TIMEOUT_S after
that. A follow-up's rewrite must finish within FIRST_TOKEN_TIMEOUT_S. With the defaults the
worst case before the stream ends is about 6 minutes, each step at its limit: rewrite 90 s,
query embedding 120 s (embed.py's HTTP timeout, which is per read, not wall clock), first token
90 s, answer 60 s. A warm GPU answers in seconds; the long limits only matter on a cold start.

Tracing (tracing.py): one trace per question with guard, rewrite, retrieve, generate and
output_check steps. Without TRACE_CONTENT the trace holds sizes, hashes and citations only,
never the question, the query or the answer.
"""

import hashlib
from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, datetime

import httpx

from cairnly import tracing
from cairnly.config import Settings, get_settings
from cairnly.guard import GUARD_REFUSAL, LeakDetector, Verdict, check_all, is_cited
from cairnly.kb import KnowledgeBase, load_prompt
from cairnly.llm import LLM, ModelTooSlow, time_limited
from cairnly.rewrite import rewrite_question
from cairnly.search import Hit, SearchResult

REFUSAL = ("I couldn't find this in the knowledge base, so I won't guess. "
           "Try rephrasing, or ask about a topic the lessons cover.")
RETRACTED = "This answer was withdrawn by a safety check."
NO_RESPONSE = ("The model did not respond in time. It may be waking up; "
               "please try again in a minute.")
TOO_SLOW = "The answer took too long and was stopped. Please try again."


def build_prompt(question: str, hits: list[Hit]) -> str:
    blocks = [f"[{n}] {h.citation}\n{h.text}" for n, h in enumerate(hits, start=1)]
    return "Sources:\n\n" + "\n\n---\n\n".join(blocks) + f"\n\nQuestion: {question}"


def source_list(hits: list[Hit]) -> list[dict]:
    return [{"n": n, "title": h.title, "trail": h.trail, "path": h.path,
             "lines": [h.start_line, h.end_line], "citation": h.citation, "url": h.url}
            for n, h in enumerate(hits, start=1)]


def digest(text: str) -> str:
    """A short fingerprint: equal questions match in traces without storing the text."""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


class _Run:
    """The trace of one answer and its open step, so an error can mark the right span."""

    def __init__(self, trace: tracing.Span, content: bool):
        self.trace, self.content = trace, content
        self.open: tracing.Span | None = None
        self.first_token = False

    def text(self, payload: dict, **texts: str) -> dict:
        """`payload`, plus the raw texts only when TRACE_CONTENT is on."""
        return {**payload, **texts} if self.content else payload

    def start(self, name: str, **fields) -> tracing.Span:
        self.open = self.trace.child(name, **fields)
        return self.open

    def finish(self, **fields) -> None:
        if self.open is not None:
            self.open.end(**fields)
            self.open = None

    def fail(self, level: str, message: str) -> None:
        self.finish(level=level, status_message=message)
        self.trace.end(level=level, status_message=message)


def answer(question: str, retrieve: Callable[[str], SearchResult], llm: LLM,
           kb: KnowledgeBase, history: Sequence[dict] = (), *, session_id: str | None = None,
           track: str | None = None, settings: Settings | None = None) -> Iterator[dict]:
    s = settings or get_settings()
    trace = tracing.start_trace(
        "ask", metadata={"prompt_version": kb.prompt},
        input={"question_sha256": digest(question), "question_chars": len(question),
               "history_turns": len(history), "kb": kb.name, "track": track,
               **({"question": question} if s.trace_content else {})},
        tags=[kb.name] + ([f"track:{track}"] if track else []),
        session_id=session_id, version=kb.prompt)
    run = _Run(trace, s.trace_content)
    try:
        yield from _steps(run, question, retrieve, llm, kb, history, s)
    except GeneratorExit:  # the client went away mid-answer
        run.fail("WARNING", "client disconnected")
        raise
    except (httpx.TimeoutException, ModelTooSlow) as exc:
        run.fail("ERROR", f"{type(exc).__name__}: "
                 + ("answer timeout" if run.first_token else "first token timeout"))
        yield {"type": "error", "message": TOO_SLOW if run.first_token else NO_RESPONSE}
    except Exception as exc:  # the API reports it in-band with a generic message
        run.fail("ERROR", type(exc).__name__)
        raise


def _steps(run: _Run, question: str, retrieve: Callable[[str], SearchResult], llm: LLM,
           kb: KnowledgeBase, history: Sequence[dict], s: Settings) -> Iterator[dict]:
    verdict = _guard(run, [question, *(turn["question"] for turn in history)], "user input")
    query = question
    if not verdict.blocked and history:
        run.start("rewrite", generation=True, model=llm.name,
                  input=run.text({"history_turns": len(history),
                                  "question_chars": len(question)}, question=question))
        query = rewrite_question(question, history, llm, time_limit_s=s.first_token_timeout_s)
        run.finish(output=run.text({"rewritten": query != question, "query_chars": len(query)},
                                   query=query),
                   usage_details=getattr(llm, "usage", None))
        if query != question:  # a forged earlier answer can only steer the rewrite
            verdict = _guard(run, [query], "rewritten query")
    if verdict.blocked:
        yield from _guard_refusal(run, llm, kb, query, verdict)
        return

    run.start("retrieve", input=run.text({"query_sha256": digest(query),
                                          "query_chars": len(query)}, query=query))
    result = retrieve(query)
    confident = bool(result.hits) and result.top_similarity >= kb.min_score
    hits = result.hits if confident else []
    run.finish(output={"top_similarity": result.top_similarity, "confident": confident,
                       "hits": [h.citation for h in result.hits]})  # corpus metadata only
    yield {"type": "sources", "sources": source_list(hits)}

    leaked = uncited = False
    if confident:
        system, prompt = load_prompt(kb.prompt), build_prompt(query, hits)
        pieces: list[str] = []
        leaked = yield from _generate(run, llm, system, prompt, kb, s, pieces)
        text = "".join(pieces)
        uncited = not leaked and not is_cited(text)
        run.start("output_check")
        run.finish(output={"leak": leaked, "cited": not uncited})
        if leaked:
            yield {"type": "retract", "message": RETRACTED}
    else:
        text = REFUSAL
        yield {"type": "token", "text": REFUSAL}

    refused, guard = not confident or leaked, "prompt_leak" if leaked else None
    _close(run, refused=refused, guard=guard, uncited=uncited, answer=text,
           top_similarity=result.top_similarity)
    yield {"type": "done", "refused": refused, "model": llm.name, "kb": kb.name,
           "prompt_version": kb.prompt, "notice": kb.notice,
           "top_similarity": round(result.top_similarity, 4), "query": query,
           "guard": guard, "uncited": uncited}


def _guard(run: _Run, texts: list[str], target: str) -> Verdict:
    run.start("guard", metadata={"checked": target})
    verdict = check_all(texts)
    run.finish(output={"blocked": verdict.blocked, "rule": verdict.rule})
    return verdict


def _guard_refusal(run: _Run, llm: LLM, kb: KnowledgeBase, query: str,
                   verdict: Verdict) -> Iterator[dict]:
    yield {"type": "sources", "sources": []}
    yield {"type": "token", "text": GUARD_REFUSAL}
    _close(run, refused=True, guard=verdict.rule, uncited=False, answer=GUARD_REFUSAL)
    yield {"type": "done", "refused": True, "model": llm.name, "kb": kb.name,
           "prompt_version": kb.prompt, "notice": kb.notice, "top_similarity": 0.0,
           "query": query, "guard": verdict.rule, "uncited": False}


def _generate(run: _Run, llm: LLM, system: str, prompt: str, kb: KnowledgeBase, s: Settings,
              pieces: list[str]) -> Iterator[dict]:
    """Stream the answer into `pieces`; return True when it leaked the prompt and was stopped.
    A missed time limit raises ModelTooSlow, which answer() turns into a friendly error."""
    step = run.start("generate", generation=True, model=llm.name,
                     input=run.text({"prompt_chars": len(prompt)}, prompt=prompt),
                     metadata={"prompt_version": kb.prompt})
    detector, leaked = LeakDetector(system), False
    stream = time_limited(llm.stream(system, prompt), s.first_token_timeout_s, s.answer_timeout_s)
    try:
        for piece in stream:
            if not run.first_token:
                run.first_token = True
                step.update(completion_start_time=datetime.now(UTC))  # time to first token
            pieces.append(piece)
            if detector.feed(piece):
                leaked = True
                break
            yield {"type": "token", "text": piece}
        else:
            leaked = detector.finish()
    finally:
        stream.close()  # stop reading from the model
    text = "".join(pieces)
    level = {"level": "WARNING", "status_message": "prompt leak"} if leaked else {}
    run.finish(output=run.text({"answer_chars": len(text), "cited": is_cited(text)},
                               answer=text),
               usage_details=getattr(llm, "usage", None), **level)
    return leaked


def _close(run: _Run, *, refused: bool, guard: str | None, uncited: bool, answer: str,
           top_similarity: float | None = None) -> None:
    """End the trace with its outcome and scores."""
    output = run.text({"refused": refused, "guard": guard, "uncited": uncited,
                       "answer_chars": len(answer)}, answer=answer)
    run.trace.update_trace(output=output)
    run.trace.score("refused", float(refused))
    run.trace.score("guard_blocked", float(guard is not None and guard != "prompt_leak"))
    run.trace.score("uncited", float(uncited))
    if top_similarity is not None:
        run.trace.score("top_similarity", round(top_similarity, 4))
    run.trace.end(output=output)
