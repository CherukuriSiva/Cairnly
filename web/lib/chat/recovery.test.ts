import { describe, expect, it } from "vitest";
import { failureForStatus, recoveryFor } from "@/lib/chat/recovery";
import type { FailureKind } from "@/lib/chat/types";

const none = new Set<FailureKind>();

describe("failureForStatus", () => {
  it("classifies the statuses the chat treats differently", () => {
    expect([503, 429, 403, 404, 500, 400].map(failureForStatus)).toEqual(["waking", "rate", "forbidden", "gone", "http", "http"]);
  });
});

describe("recoveryFor", () => {
  it("waits and resends once on a cold start, honouring Retry-After within bounds", () => {
    expect(recoveryFor({ kind: "waking", message: "" }, none)).toEqual({ type: "resend", delayMs: 3000 });
    expect(recoveryFor({ kind: "waking", message: "", retryAfterS: 8 }, none)).toEqual({ type: "resend", delayMs: 8000 });
    expect(recoveryFor({ kind: "waking", message: "", retryAfterS: 600 }, none)).toEqual({ type: "resend", delayMs: 15000 });
  });

  it("waits out a short rate limit once, and only shows a long one", () => {
    expect(recoveryFor({ kind: "rate", message: "", retryAfterS: 4 }, none)).toEqual({ type: "resend", delayMs: 4000 });
    expect(recoveryFor({ kind: "rate", message: "", retryAfterS: 3600 }, none)).toEqual({ type: "show", action: "retry" });
    expect(recoveryFor({ kind: "rate", message: "" }, none)).toEqual({ type: "show", action: "retry" });
  });

  it("resends once after a network failure or a stall, and in a new conversation when it is gone", () => {
    expect(recoveryFor({ kind: "network", message: "" }, none)).toMatchObject({ type: "resend", delayMs: 3000 });
    expect(recoveryFor({ kind: "stall", message: "" }, none)).toMatchObject({ type: "resend" });
    expect(recoveryFor({ kind: "gone", message: "" }, none)).toEqual({ type: "resend", delayMs: 0, fresh: true });
  });

  it("uses each automatic recovery at most once per question", () => {
    for (const kind of ["waking", "network", "stall", "gone"] as const) {
      expect(recoveryFor({ kind, message: "" }, new Set([kind]))).toEqual({ type: "show", action: "retry" });
    }
    expect(recoveryFor({ kind: "network", message: "" }, new Set<FailureKind>(["waking"]))).toMatchObject({ type: "resend" });
  });

  it("never resends timeouts, refusals or server errors on its own", () => {
    for (const kind of ["timeout", "forbidden", "http", "answer", "ended", "stopped"] as const) {
      expect(recoveryFor({ kind, message: "" }, none)).toEqual({ type: "show", action: "retry" });
    }
  });
});
