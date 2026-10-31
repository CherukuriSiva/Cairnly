import { describe, expect, it } from "vitest";
import { getNews, loadSource, mergeGroup, type Fetcher, type LastGood } from "./fetch";
import type { Source } from "./sources";
import type { SourceResult } from "./types";

const feed = (items: { title: string; link: string; date?: string }[]) =>
  `<rss><channel>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.date ? `<pubDate>${i.date}</pubDate>` : ""}</item>`)
    .join("")}</channel></rss>`;

const blog = (id: string, limit = 3): Source => ({
  id,
  name: id.toUpperCase(),
  group: "blogs",
  url: `https://${id}.example/feed`,
  kind: "feed",
  limit,
});

const ok = (bodies: Record<string, string>): Fetcher => async (url) => {
  const body = bodies[url];
  if (body === undefined) throw new Error("HTTP 404");
  return body;
};

describe("getNews", () => {
  it("keeps the other sources when one fails, and shows nothing for a source never fetched", async () => {
    const sources = [blog("a"), blog("b")];
    const fetcher = ok({ "https://a.example/feed": feed([{ title: "A1", link: "https://a.example/1" }]) });
    const news = await getNews(fetcher, sources, new Map());
    expect(news.blogs.map((i) => i.title)).toEqual(["A1"]);
  });

  it("returns empty groups, without throwing, when every source fails", async () => {
    const news = await getNews(async () => { throw new Error("offline"); }, [blog("a")], new Map());
    expect(news).toEqual({ community: [], papers: [], blogs: [] });
  });

  it("reuses the last good items when a source later fails, on 500, timeout or garbage", async () => {
    const cache: LastGood = new Map();
    const sources = [blog("a")];
    const good = ok({ "https://a.example/feed": feed([{ title: "A1", link: "https://a.example/1" }]) });
    await getNews(good, sources, cache);
    const failures: Fetcher[] = [
      async () => { throw new Error("HTTP 500"); },
      async () => { throw new DOMException("The operation timed out", "TimeoutError"); },
      async () => "<html>not a feed</html>",
    ];
    for (const failing of failures) {
      const news = await getNews(failing, sources, cache);
      expect(news.blogs.map((i) => i.title)).toEqual(["A1"]);
    }
  });

  it("marks a fallback result stale and a fresh one not", async () => {
    const cache: LastGood = new Map();
    const source = blog("a");
    const fresh = await loadSource(source, ok({ "https://a.example/feed": feed([{ title: "A1", link: "https://a.example/1" }]) }), cache);
    expect(fresh).toMatchObject({ ok: true, stale: false });
    const down = await loadSource(source, async () => { throw new Error("down"); }, cache);
    expect(down).toMatchObject({ ok: false, stale: true });
    expect(down.items).toHaveLength(1);
    const never = await loadSource(blog("b"), async () => { throw new Error("down"); }, cache);
    expect(never).toMatchObject({ ok: false, stale: false, items: [] });
  });

  it("applies the title filter only to sources that ask for it, then the source limit", async () => {
    const hn: Source = { id: "hn", name: "Hacker News", group: "community", url: "https://hn.example", kind: "hn", limit: 2, filter: true };
    const hits = [
      { objectID: "1", title: "Wall Street closes", url: "https://x.example/1", created_at: "2026-10-31T10:00:00Z" },
      { objectID: "2", title: "LLM evals in practice", url: "https://x.example/2", created_at: "2026-10-31T09:00:00Z" },
      { objectID: "3", title: "RAG pipelines", url: "https://x.example/3", created_at: "2026-10-31T08:00:00Z" },
      { objectID: "4", title: "Agents everywhere", url: "https://x.example/4", created_at: "2026-10-31T07:00:00Z" },
    ];
    const news = await getNews(ok({ "https://hn.example": JSON.stringify({ hits }) }), [hn], new Map());
    expect(news.community.map((i) => i.title)).toEqual(["LLM evals in practice", "RAG pipelines"]);
  });
});

describe("mergeGroup", () => {
  const result = (source: string, items: [string, string, string][]): SourceResult => ({
    source,
    group: "blogs",
    ok: true,
    stale: false,
    items: items.map(([title, url, date]) => ({ id: url, source, group: "blogs", title, url, date, summary: "" })),
  });

  it("drops duplicate links, sorts newest first and puts undated items last", () => {
    const merged = mergeGroup(
      [
        result("A", [["old", "https://e.example/old", "2026-10-01T00:00:00.000Z"], ["undated", "https://e.example/u", ""]]),
        result("B", [["new", "https://e.example/new", "2026-10-31T00:00:00.000Z"], ["dup", "https://e.example/old", "2026-10-01T00:00:00.000Z"]]),
      ],
      "blogs",
    );
    expect(merged.map((i) => i.title)).toEqual(["new", "old", "undated"]);
  });

  it("caps the group at 12 for blogs", () => {
    const many = Array.from({ length: 20 }, (_, i): [string, string, string] => [
      `t${i}`,
      `https://e.example/${i}`,
      `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    ]);
    const merged = mergeGroup([result("A", many)], "blogs");
    expect(merged).toHaveLength(12);
    expect(merged[0].title).toBe("t19");
  });

  it("only takes items of the asked group", () => {
    expect(mergeGroup([result("A", [["x", "https://e.example/x", ""]])], "papers")).toEqual([]);
  });
});
