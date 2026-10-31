"""Answer a question from retrieved sources, streaming events a UI can render.

Event stream (one dict per event):
    {"type": "sources", "sources": [...]}   numbered like the [n] markers in the answer; each
                                            source has a page "url" ("" when it has no page)
    {"type": "token", "text": "..."}        answer text, piece by piece
    {"type": "done", "refused": bool, "model": "...", "prompt_version": "...", "kb": "...",
     "top_similarity": 0.83, "query": "..."}   query = what was searched

Follow-ups: with earlier turns in `history`, the question is first rewritten into a standalone
one (rewrite.py), and search and the answer prompt use that.

Confidence gate: when even the best match is weakly similar, the corpus probably does not cover
the question. Refusing then is better than letting the model answer from its own memory with
citations that do not support it.
"""

from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, datetime

from cairnly import tracing
from cairnly.kb import KnowledgeBase, load_prompt
from cairnly.llm import LLM
from cairnly.rewrite import rewrite_question
from cairnly.search import Hit, SearchResult

REFUSAL = ("I couldn't find this in the knowledge base, so I won't guess. "
           "Try rephrasing, or ask about a topic the lessons cover.")


def build_prompt(question: str, hits: list[Hit]) -> str:
    blocks = [f"[{n}] {h.citation}\n{h.text}" for n, h in enumerate(hits, start=1)]
    return "Sources:\n\n" + "\n\n---\n\n".join(blocks) + f"\n\nQuestion: {question}"


def source_list(hits: list[Hit]) -> list[dict]:
    return [{"n": n, "title": h.title, "trail": h.trail, "path": h.path,
             "lines": [h.start_line, h.end_line], "citation": h.citation, "url": h.url}
            for n, h in enumerate(hits, start=1)]


def answer(question: str, retrieve: Callable[[str], SearchResult], llm: LLM,
           kb: KnowledgeBase, history: Sequence[dict] = ()) -> Iterator[dict]:
    trace = tracing.start_trace("ask", input={"question": question, "kb": kb.name},
                                metadata={"prompt_version": kb.prompt}, tags=[kb.name])
    query = question
    if history:
        step = trace.child("rewrite", generation=True, model=llm.name, input=question)
        query = rewrite_question(question, history, llm)
        step.end(output=query)
    step = trace.child("retrieve", input=query)
    result = retrieve(query)
    confident = bool(result.hits) and result.top_similarity >= kb.min_score
    hits = result.hits if confident else []
    step.end(output={"top_similarity": result.top_similarity, "confident": confident,
                     "hits": [h.citation for h in result.hits]})
    yield {"type": "sources", "sources": source_list(hits)}

    pieces: list[str] = []
    if confident:
        step = trace.child("generate", generation=True, model=llm.name, input=query,
                           metadata={"prompt_version": kb.prompt})
        for piece in llm.stream(load_prompt(kb.prompt), build_prompt(query, hits)):
            if not pieces:
                step.update(completion_start_time=datetime.now(UTC))  # time to first token
            pieces.append(piece)
            yield {"type": "token", "text": piece}
        step.end(output="".join(pieces))
    else:
        pieces.append(REFUSAL)
        yield {"type": "token", "text": REFUSAL}
    done = {"type": "done", "refused": not confident, "model": llm.name, "kb": kb.name,
            "prompt_version": kb.prompt, "notice": kb.notice,
            "top_similarity": round(result.top_similarity, 4), "query": query}
    trace.end(output={"answer": "".join(pieces), "refused": not confident})
    yield done
