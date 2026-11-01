"""A client that disconnects mid-answer, against a real Uvicorn server.

TestClient cannot show this: it never disconnects, and Starlette's handling differs by ASGI
version. Here a real server streams a slow fake answer, the client closes its socket after the
first pieces, and the test checks that the model stream was closed and the answer slot freed
within seconds, without help from the garbage collector (which is switched off meanwhile).
"""

import gc
import json
import socket
import threading
import time

import pytest
import uvicorn

from cairnly import api
from cairnly.limits import AnswerSlots, RateLimiter
from cairnly.search import Hit, SearchResult

HIT = Hit(1, "What is RAG", "rag.md", "Idea", 1, 4, "Retrieve then generate.", 0.03, 0.9)
PIECE_DELAY_S = 0.1  # the fake model sends a piece this often
PIECES = 300  # 30 s of answer: far longer than the test waits
CLEANUP_LIMIT_S = 5  # the model stream must be closed and the slot freed within this


class SlowLLM:
    name = "fake/slow"
    usage = None

    def __init__(self):
        self.closed = threading.Event()  # set by the stream's finally

    def stream(self, system, prompt):
        try:
            for n in range(PIECES):
                time.sleep(PIECE_DELAY_S)
                yield f"piece {n} [1] "
        finally:
            self.closed.set()


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(monkeypatch):
    llm = SlowLLM()
    monkeypatch.setattr(api, "connect", lambda: FakeConn())
    monkeypatch.setattr(api, "search_kb",
                        lambda conn, q, kb, top_k=6, track=None: SearchResult([HIT], 0.9))
    monkeypatch.setattr(api, "get_llm", lambda provider=None: llm)
    monkeypatch.setattr(api, "limiter", RateLimiter(10, 200, 2000))
    monkeypatch.setattr(api, "slots", AnswerSlots(1))  # one slot: "freed" is easy to see

    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=port,
                                        log_level="warning", lifespan="off"))
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not srv.started:
        assert time.monotonic() < deadline, "uvicorn did not start"
        time.sleep(0.02)
    yield port, llm
    srv.should_exit = True
    thread.join(10)


def _slot_is_free() -> bool:
    slot = api.slots.acquire()
    if slot is None:
        return False
    slot.release()
    return True


def test_a_client_disconnect_closes_the_model_stream_and_frees_the_slot(server):
    port, llm = server
    body = json.dumps({"question": "What is RAG?"}).encode()
    request = (b"POST /ask HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n"
               b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)

    gc.disable()  # the cleanup must not wait for the garbage collector
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=10) as conn:
            conn.sendall(request)
            received = b""
            while b"piece 2" not in received:  # the answer is streaming
                chunk = conn.recv(4096)
                assert chunk, "the server closed the stream early"
                received += chunk
            assert not _slot_is_free()  # held while the answer streams
        # The socket is closed here: the client has gone away mid-answer.
        assert llm.closed.wait(CLEANUP_LIMIT_S), "the model stream was not closed"
        deadline = time.monotonic() + CLEANUP_LIMIT_S
        while not _slot_is_free():
            assert time.monotonic() < deadline, "the answer slot was not freed"
            time.sleep(0.05)
    finally:
        gc.enable()
