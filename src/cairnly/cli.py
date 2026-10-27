"""Command line: `cairnly <command>`. Each command is a thin wrapper over one module."""

import argparse
from pathlib import Path


def cmd_curate(args: argparse.Namespace) -> None:
    from cairnly.curate import curate, report, write_corpus

    items = curate(Path(args.source))
    write_corpus(items, Path(args.out))
    Path(args.report).write_text(report(items))
    kept = sum(i.decision != "dropped" for i in items)
    print(f"{len(items)} files read, {kept} written to {args.out}/, report in {args.report}")


def cmd_migrate(args: argparse.Namespace) -> None:
    from cairnly.db import connect, migrate

    with connect() as conn:
        migrate(conn)
    print("schema ready")


def cmd_ingest(args: argparse.Namespace) -> None:
    from cairnly.db import connect
    from cairnly.ingest import ingest_folder

    folder = Path(args.folder)
    with connect() as conn:
        stats = ingest_folder(conn, folder, args.source or folder.name)
    print(f"added {stats.added}, updated {stats.updated}, unchanged {stats.unchanged}, "
          f"deleted {stats.deleted}; {stats.chunks} chunks embedded")


def cmd_search(args: argparse.Namespace) -> None:
    from cairnly.db import connect
    from cairnly.search import search

    with connect() as conn:
        result = search(conn, args.query, top_k=args.k)
    print(f"top similarity {result.top_similarity:.3f}")
    for n, hit in enumerate(result.hits, start=1):
        print(f"{n}. [{hit.score:.4f}] {hit.citation}")


def cmd_ask(args: argparse.Namespace) -> None:
    from cairnly.answer import answer
    from cairnly.config import get_settings
    from cairnly.db import connect
    from cairnly.llm import get_llm
    from cairnly.search import search

    s = get_settings()
    with connect() as conn:
        for event in answer(args.question, lambda q: search(conn, q, top_k=s.top_k),
                            get_llm(args.provider), s.min_score):
            if event["type"] == "token":
                print(event["text"], end="", flush=True)
            elif event["type"] == "sources":
                sources = event["sources"]
    print("\n")
    for src in sources:
        print(f"[{src['n']}] {src['citation']}")


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("cairnly.api:app", host=args.host, port=args.port, reload=args.reload)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cairnly")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("curate", help="convert MDX lessons into the markdown corpus")
    p.add_argument("source", help="content folder to read (never modified)")
    p.add_argument("--out", default="corpus")
    p.add_argument("--report", default="CURATION.md")
    p.set_defaults(func=cmd_curate)

    p = sub.add_parser("migrate", help="create the database schema")
    p.set_defaults(func=cmd_migrate)

    p = sub.add_parser("ingest", help="chunk, embed and store a folder of markdown")
    p.add_argument("folder")
    p.add_argument("--source", help="label for this folder (default: its name)")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("search", help="show the top hybrid-search hits for a query")
    p.add_argument("query")
    p.add_argument("-k", type=int, default=6)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("ask", help="answer a question with citations")
    p.add_argument("question")
    p.add_argument("--provider", choices=["ollama", "anthropic"])
    p.set_defaults(func=cmd_ask)

    p = sub.add_parser("serve", help="run the HTTP API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8010)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
