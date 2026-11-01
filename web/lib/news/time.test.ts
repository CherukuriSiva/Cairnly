import { describe, expect, it } from "vitest";
import { formatDate, refreshedAgo, relativeTime } from "./time";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe("formatDate", () => {
  it("formats an ISO date in UTC and gives nothing for a missing or bad one", () => {
    expect(formatDate("2026-10-31T23:30:00.000Z")).toBe("31 Oct 2026");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("relativeTime", () => {
  it("counts minutes, hours and days", () => {
    expect(relativeTime(ago(20_000), NOW)).toBe("just now");
    expect(relativeTime(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(relativeTime(ago(3 * 60 * MIN + 59 * MIN), NOW)).toBe("3h ago");
    expect(relativeTime(ago(2 * 24 * 60 * MIN), NOW)).toBe("2d ago");
  });

  it("falls back to the date after 30 days or for a future date", () => {
    expect(relativeTime("2026-09-01T00:00:00.000Z", NOW)).toBe(formatDate("2026-09-01T00:00:00.000Z"));
    expect(relativeTime("2026-09-01T00:00:00.000Z", NOW)).toMatch(/^1 Sept? 2026$/);
    expect(relativeTime(new Date(NOW + 60 * MIN).toISOString(), NOW)).toBe("2 Nov 2026");
    expect(relativeTime(new Date(NOW + MIN).toISOString(), NOW)).toBe("just now");
  });

  it("gives nothing without a readable date", () => {
    expect(relativeTime("", NOW)).toBe("");
    expect(relativeTime("garbage", NOW)).toBe("");
  });
});

describe("refreshedAgo", () => {
  it("says how long ago the page was built", () => {
    expect(refreshedAgo(ago(10_000), NOW)).toBe("just now");
    expect(refreshedAgo(ago(12 * MIN), NOW)).toBe("12 min ago");
    expect(refreshedAgo(ago(60 * MIN), NOW)).toBe("1 hour ago");
    expect(refreshedAgo(ago(150 * MIN), NOW)).toBe("2 hours ago");
    expect(refreshedAgo("bad", NOW)).toBe("");
  });
});
