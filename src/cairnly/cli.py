"""Command line: `cairnly <command>`. Each command is a thin wrapper over one module."""

import argparse
import sys
from pathlib import Path


def cmd_migrate(args: argparse.Namespace) -> None:
    from cairnly.db import connect, migrate

    with connect() as conn:
        migrate(conn)
    print("schema ready")


def cmd_ingest(args: argparse.Namespace) -> None:
    from cairnly.db import connect
    from cairnly.ingest import docs_for, ingest_docs
    from cairnly.kb import get_kb

    path = Path(args.path or get_kb(args.kb).path)
    with connect() as conn:
        stats = ingest_docs(conn, docs_for(path), args.kb)
    print(f"[{args.kb}] added {stats.added}, updated {stats.updated}, "
          f"unchanged {stats.unchanged}, deleted {stats.deleted}; {stats.chunks} chunks embedded")


def cmd_search(args: argparse.Namespace) -> None:
    from cairnly.db import connect
    from cairnly.kb import get_kb
    from cairnly.search import search, search_kb

    with connect() as conn:
        result = (search_kb(conn, args.query, get_kb(args.kb), top_k=args.k) if args.kb
                  else search(conn, args.query, top_k=args.k))
    print(f"top similarity {result.top_similarity:.3f}")
    for n, hit in enumerate(result.hits, start=1):
        print(f"{n}. [{hit.score:.4f}] {hit.citation}")


def cmd_ask(args: argparse.Namespace) -> None:
    from cairnly.answer import answer
    from cairnly.config import get_settings
    from cairnly.db import connect
    from cairnly.kb import get_kb
    from cairnly.llm import get_llm
    from cairnly.search import search_kb

    s, kb = get_settings(), get_kb(args.kb)
    sources: list[dict] = []
    with connect() as conn:
        for event in answer(args.question, lambda q: search_kb(conn, q, kb, top_k=s.top_k),
                            get_llm(args.provider), kb):
            if event["type"] == "token":
                print(event["text"], end="", flush=True)
            elif event["type"] == "sources":
                sources = event["sources"]
            elif event["type"] in ("retract", "error"):
                print(f"\n{event['message']}", file=sys.stderr)
    print("\n")
    for src in sources:
        print(f"[{src['n']}] {src['citation']}")
    if kb.notice:
        print(f"\n{kb.notice}")
    from cairnly import tracing

    tracing.flush()


def cmd_eval(args: argparse.Namespace) -> None:
    from cairnly.evals import main as eval_main

    eval_main(args)


def cmd_eval_followups(args: argparse.Namespace) -> None:
    from cairnly.evals import followups_main

    followups_main(args)


def cmd_eval_redteam(args: argparse.Namespace) -> None:
    from cairnly.evals import redteam_main

    redteam_main(args)


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("cairnly.api:app", host=args.host, port=args.port, reload=args.reload)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cairnly")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("migrate", help="create the database schema")
    p.set_defaults(func=cmd_migrate)

    p = sub.add_parser("ingest", help="chunk, embed and store one knowledge base")
    p.add_argument("--kb", default="lessons", help="knowledge base name from kbs.yaml")
    p.add_argument("--path", help="override the path from kbs.yaml")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("search", help="show the top hybrid-search hits for a query")
    p.add_argument("query")
    p.add_argument("-k", type=int, default=6)
    p.add_argument("--kb", help="limit to one knowledge base")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("ask", help="answer a question with citations")
    p.add_argument("question")
    p.add_argument("--kb", default="lessons")
    p.add_argument("--provider", choices=["ollama", "anthropic"])
    p.set_defaults(func=cmd_ask)

    p = sub.add_parser("eval", help="score retrieval (and optionally answers) on a golden set")
    p.add_argument("--kb", default="lessons")
    p.add_argument("--set", dest="golden", help="golden set file (default: per kb)")
    p.add_argument("-k", type=int, default=5)
    p.add_argument("--limit", type=int, help="only the first N questions")
    p.add_argument("--judge", action="store_true", help="also score answer faithfulness")
    p.add_argument("--gate", help="fail (exit 1) if metrics drop below this thresholds file")
    p.add_argument("--out", help="write the JSON report here")
    p.set_defaults(func=cmd_eval)

    p = sub.add_parser("eval-followups",
                       help="search recall: rewritten follow-ups vs. standalone questions")
    p.add_argument("--kb", default="lessons")
    p.add_argument("--set", dest="golden", default="evals/followups.jsonl")
    p.add_argument("-k", type=int, default=5)
    p.add_argument("--provider", choices=["ollama", "anthropic"])
    p.set_defaults(func=cmd_eval_followups)

    p = sub.add_parser("eval-redteam",
                       help="input guard: wrong blocks and missed attacks (no DB, no model)")
    p.add_argument("--kb", default="lessons", help="its golden questions must all pass")
    p.add_argument("--set", dest="golden", default="evals/redteam.jsonl")
    p.add_argument("--heldout", default="evals/redteam-heldout.jsonl",
                   help="rows never used for tuning: reported next to the set, not gated")
    p.add_argument("--gate", help="fail (exit 1) if rates break the redteam: limits here")
    p.add_argument("--out", help="write the JSON report here")
    p.set_defaults(func=cmd_eval_redteam)

    p = sub.add_parser("serve", help="run the HTTP API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8010)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    if getattr(args, "provider", None):
        require_provider(args.provider)
    args.func(args)


def require_provider(provider: str) -> None:
    """Stop with exit code 2 when the chosen provider is turned off (Claude without
    ALLOW_ANTHROPIC), before any database or model work starts."""
    from cairnly.llm import ProviderDisabled, check_provider

    try:
        check_provider(provider)
    except ProviderDisabled as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
