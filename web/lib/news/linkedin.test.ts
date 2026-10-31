import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLinkedInPicks } from "./linkedin";

let dir: string;

function writeYaml(text: string) {
  fs.mkdirSync(path.join(dir, "news"), { recursive: true });
  fs.writeFileSync(path.join(dir, "news", "linkedin.yaml"), text);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("loadLinkedInPicks", () => {
  it("returns [] and warns with the path when the file is missing", () => {
    expect(loadLinkedInPicks(dir)).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(path.join(dir, "news", "linkedin.yaml"));
  });

  it("returns [] for an empty list and for an empty file", () => {
    writeYaml("picks: []\n");
    expect(loadLinkedInPicks(dir)).toEqual([]);
    writeYaml("");
    expect(loadLinkedInPicks(dir)).toEqual([]);
  });

  it("returns [] for broken YAML without throwing", () => {
    writeYaml("picks: [unclosed\n  - : :");
    expect(loadLinkedInPicks(dir)).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("reads valid picks, newest first, with bare YAML dates", () => {
    writeYaml(`picks:
  - url: https://www.linkedin.com/posts/one
    author: Jane Doe
    title: Older post
    note: A short note.
    date: 2026-10-01
  - url: https://linkedin.com/posts/two
    author: John Roe
    title: Newer post
    date: "2026-10-30"
  - url: https://uk.linkedin.com/posts/three
    author: No Date
    title: Undated
`);
    const picks = loadLinkedInPicks(dir);
    expect(picks.map((p) => p.title)).toEqual(["Newer post", "Older post", "Undated"]);
    expect(picks[1]).toEqual({
      url: "https://www.linkedin.com/posts/one",
      author: "Jane Doe",
      title: "Older post",
      note: "A short note.",
      date: "2026-10-01",
    });
  });

  it("skips and warns about invalid entries", () => {
    writeYaml(`picks:
  - url: https://example.com/not-linkedin
    author: A
    title: Wrong host
  - url: https://notlinkedin.com/posts/x
    author: A
    title: Look alike host
  - url: http://www.linkedin.com/posts/plain-http
    author: A
    title: Not https
  - url: javascript:alert(1)
    author: A
    title: Script
  - url: https://www.linkedin.com/posts/no-title
    author: A
  - url: https://www.linkedin.com/posts/no-author
    title: T
  - url: https://www.linkedin.com/posts/bad-date
    author: A
    title: T
    date: yesterday
  - url: https://www.linkedin.com/posts/long-note
    author: A
    title: T
    note: ${"x".repeat(301)}
  - just a string
  - url: https://www.linkedin.com/posts/good
    author: A
    title: Good one
`);
    const picks = loadLinkedInPicks(dir);
    expect(picks.map((p) => p.title)).toEqual(["Good one"]);
    expect(console.warn).toHaveBeenCalledTimes(9);
  });

  it("turns HTML in a title or note into plain text", () => {
    writeYaml(`picks:
  - url: https://www.linkedin.com/posts/html
    author: A
    title: "<b>Bold</b> &amp; <script>x</script>clean"
`);
    expect(loadLinkedInPicks(dir)[0].title).toBe("Bold & clean");
  });
});
