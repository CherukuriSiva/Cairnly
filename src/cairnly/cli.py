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

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
