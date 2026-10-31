import { describe, expect, it } from "vitest";
import { cleanText, safeUrl, toIsoDate, truncate } from "./text";

describe("cleanText", () => {
  it("strips tags and decodes entities", () => {
    expect(cleanText("<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot; &#39;x&#39; &#x41;&nbsp;B</p>")).toBe(
      "Tom & Jerry <3 \"cheese\" 'x' A B",
    );
  });

  it("removes script and style content, also when escaped in the feed", () => {
    expect(cleanText("Hi<script>alert(1)</script> there")).toBe("Hi there");
    expect(cleanText("&lt;script&gt;alert(1)&lt;/script&gt;Safe")).toBe("Safe");
    expect(cleanText("<style>p{color:red}</style>Text")).toBe("Text");
  });

  it("collapses whitespace and leaves unknown entities alone", () => {
    expect(cleanText("  a \n\n b\t&bogus; ")).toBe("a b &bogus;");
  });

  it("keeps an out of range numeric entity as written", () => {
    expect(cleanText("x &#99999999999; y")).toBe("x &#99999999999; y");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("short", 200)).toBe("short");
  });

  it("cuts a 5000 character summary to at most 200 characters with an ellipsis", () => {
    const out = truncate("word ".repeat(1000), 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("cuts at a word boundary when there is one", () => {
    expect(truncate("alpha beta gamma delta", 15)).toBe("alpha beta…");
  });

  it("hard cuts text with no spaces", () => {
    expect(truncate("x".repeat(500), 200).length).toBe(200);
  });
});

describe("safeUrl", () => {
  it("accepts http and https", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("rejects other schemes, junk and non strings", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("  JavaScript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeUrl("/relative/path")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe("toIsoDate", () => {
  it("normalises RFC 822 and ISO dates", () => {
    expect(toIsoDate("Fri, 31 Oct 2026 10:00:00 GMT")).toBe("2026-10-31T10:00:00.000Z");
    expect(toIsoDate("2026-10-31T10:00:00Z")).toBe("2026-10-31T10:00:00.000Z");
  });

  it("gives an empty string for unreadable input", () => {
    expect(toIsoDate("not a date")).toBe("");
    expect(toIsoDate(undefined)).toBe("");
    expect(toIsoDate({})).toBe("");
  });
});
