import { describe, expect, it } from "vitest";
import { parseFeed, parseHfPapers, parseHn } from "./parse";

const origin = { name: "Test Source", group: "blogs" as const };

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
  <item>
    <title><![CDATA[Evals & <b>Agents</b>]]></title>
    <link>https://example.com/a</link>
    <pubDate>Fri, 31 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <script>alert(1)</script>world &amp; more</p>]]></description>
  </item>
  <item>
    <title>No description</title>
    <link>https://example.com/b</link>
  </item>
  <item>
    <title>Bad link</title>
    <link>javascript:alert(1)</link>
  </item>
  <item>
    <title>Missing link</title>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Atom &amp;amp; title</title>
    <link rel="self" href="https://example.com/self"/>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <published>2026-10-30T08:00:00Z</published>
    <summary type="html">&lt;p&gt;Escaped &lt;em&gt;HTML&lt;/em&gt; summary&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Only updated</title>
    <link href="https://example.com/atom-2"/>
    <updated>2026-10-29T08:00:00Z</updated>
    <content>Body text</content>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS with CDATA and drops items without a safe link", () => {
    const items = parseFeed(RSS, origin);
    expect(items.map((i) => i.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(items[0]).toMatchObject({
      source: "Test Source",
      group: "blogs",
      title: "Evals & Agents",
      date: "2026-10-31T10:00:00.000Z",
      summary: "Hello world & more",
    });
    expect(items[1]).toMatchObject({ summary: "", date: "" });
  });

  it("reads Atom, picking the alternate link and unescaping HTML summaries", () => {
    const items = parseFeed(ATOM, origin);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: "https://example.com/atom-1",
      title: "Atom & title",
      date: "2026-10-30T08:00:00.000Z",
      summary: "Escaped HTML summary",
    });
    expect(items[1]).toMatchObject({ url: "https://example.com/atom-2", date: "2026-10-29T08:00:00.000Z", summary: "Body text" });
  });

  it("handles a feed with a single item or entry", () => {
    const rss = `<rss><channel><item><title>One</title><link>https://example.com/one</link></item></channel></rss>`;
    const atom = `<feed><entry><title>Solo</title><link href="https://example.com/solo"/></entry></feed>`;
    expect(parseFeed(rss, origin)).toHaveLength(1);
    expect(parseFeed(atom, origin)).toHaveLength(1);
  });

  it("caps a huge summary at 200 characters", () => {
    const rss = `<rss><channel><item><title>T</title><link>https://example.com/t</link><description>${"word ".repeat(1000)}</description></item></channel></rss>`;
    expect(parseFeed(rss, origin)[0].summary.length).toBeLessThanOrEqual(200);
  });

  it("returns [] for malformed or unrelated input without throwing", () => {
    expect(parseFeed("<rss><channel><item><title>x", origin)).toEqual([]);
    expect(parseFeed("", origin)).toEqual([]);
    expect(parseFeed("<html><body>not a feed</body></html>", origin)).toEqual([]);
    expect(parseFeed('{"json": true}', origin)).toEqual([]);
  });
});

describe("parseHn", () => {
  it("links titles to the HN discussion and keeps a safe story link aside", () => {
    const json = JSON.stringify({
      hits: [
        { objectID: "1", title: "With url", url: "https://example.com/story", created_at: "2026-10-31T09:00:00.000Z", points: 120 },
        { objectID: "2", title: "Ask HN: no url", url: null, created_at: "2026-10-31T08:00:00.000Z", points: 45 },
        { objectID: "3", title: "Bad scheme", url: "javascript:alert(1)", created_at: "2026-10-31T07:00:00.000Z" },
        { objectID: "4", url: "https://example.com/untitled" },
        { title: "No id", url: "https://example.com/no-id" },
      ],
    });
    const items = parseHn(json, origin);
    expect(items.map((i) => i.url)).toEqual([
      "https://news.ycombinator.com/item?id=1",
      "https://news.ycombinator.com/item?id=2",
      "https://news.ycombinator.com/item?id=3",
      "https://example.com/no-id",
    ]);
    expect(items.map((i) => i.storyUrl)).toEqual(["https://example.com/story", undefined, undefined, undefined]);
    expect(items[0].summary).toBe("120 points on Hacker News");
    expect(items[2].summary).toBe("");
  });

  it("returns [] for malformed input", () => {
    expect(parseHn("not json", origin)).toEqual([]);
    expect(parseHn("[]", origin)).toEqual([]);
    expect(parseHn('{"hits": "nope"}', origin)).toEqual([]);
  });
});

describe("parseHfPapers", () => {
  it("links to the paper page and uses the entry or paper summary", () => {
    const json = JSON.stringify([
      { title: "Paper A", publishedAt: "2026-10-31T00:00:00.000Z", summary: "About <b>A</b>", paper: { id: "2610.00001" } },
      { paper: { id: "2610.00002", title: "Paper B", summary: "About B", publishedAt: "2026-10-30T00:00:00.000Z" } },
      { title: "No id", paper: {} },
    ]);
    const items = parseHfPapers(json, origin);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: "https://huggingface.co/papers/2610.00001", summary: "About A" });
    expect(items[1]).toMatchObject({ title: "Paper B", summary: "About B", date: "2026-10-30T00:00:00.000Z" });
  });

  it("returns [] for malformed input", () => {
    expect(parseHfPapers("oops", origin)).toEqual([]);
    expect(parseHfPapers('{"a":1}', origin)).toEqual([]);
  });
});
