// The replay transport: plays recorded /ask event streams with their real timing (scaled by a
// speed factor), so tests can drive the whole chat without a server and the site can be demoed
// with ?demo=1 while the backend is asleep. Each scenario lists one stream per try, so a
// scenario can fail first and succeed on the retry; the last try repeats.

import type { AskBody, AskEvent } from "@/lib/ask";
import { RECORDED_QUESTIONS, RECORDINGS, type RecordedStep } from "@/lib/chat/recordings";
import { TransportError, type ChatTransport } from "@/lib/chat/transport";
import type { FailureKind } from "@/lib/chat/types";

/** One step of a recorded try: wait `delayMs`, then send an event (or raw frame data), or fail. */
export type ReplayStep =
  | { delayMs: number; event: AskEvent }
  | { delayMs: number; raw: string } // for tests: malformed or unknown frames
  | { delayMs: number; fail: { kind: FailureKind; message: string; status?: number; retryAfterS?: number } };

export interface Scenario {
  name: string;
  label: string; // what the demo says it shows
  question: string;
  tries: ReplayStep[][];
}

const STREAM_ERROR = "Something went wrong while writing the answer.";

const steps = (recorded: RecordedStep[]): ReplayStep[] => recorded.map(([delayMs, event]) => ({ delayMs, event }));

/** The recorded answer cut part-way: the server reports an error in the stream. */
function cutAfter(recorded: RecordedStep[], tokens: number): ReplayStep[] {
  const out: ReplayStep[] = [];
  let seen = 0;
  for (const [delayMs, event] of recorded) {
    if (event.type === "token" && seen++ >= tokens) break;
    out.push({ delayMs, event });
  }
  out.push({ delayMs: 1500, event: { type: "error", message: STREAM_ERROR } });
  return out;
}

/** The recorded answer after a slow wake: the first try is a 503 (still starting), the retry
 * waits 6.5 s for its first token, long enough for the waking note. */
function afterSlowWake(recorded: RecordedStep[]): ReplayStep[][] {
  const [sources, firstToken, ...rest] = steps(recorded);
  return [
    [{ delayMs: 900, fail: { kind: "waking", message: "Request failed (503)", status: 503, retryAfterS: 3 } }],
    [sources, { ...firstToken, delayMs: 6500 }, ...rest],
  ];
}

export const SCENARIOS: Scenario[] = [
  { name: "answer", label: "A cited answer", question: RECORDED_QUESTIONS.answer, tries: [steps(RECORDINGS.answer)] },
  { name: "refusal", label: "Not in the lessons", question: RECORDED_QUESTIONS.refusal, tries: [steps(RECORDINGS.refusal)] },
  { name: "guard", label: "Blocked by the safety check", question: RECORDED_QUESTIONS.guard, tries: [steps(RECORDINGS.guard)] },
  { name: "wake", label: "A slow cold start", question: RECORDED_QUESTIONS.wake, tries: afterSlowWake(RECORDINGS.wake) },
  {
    name: "cut",
    label: "An error mid-answer, then Retry",
    question: RECORDED_QUESTIONS.cut,
    tries: [cutAfter(RECORDINGS.cut, 40), steps(RECORDINGS.cut)],
  },
];

/** The scenario for a question: an exact sample question, else a few keywords, else the
 * out-of-scope refusal (a recording cannot answer a new question). */
export function pickScenario(question: string, scenarios: Scenario[] = SCENARIOS): Scenario {
  const q = question.trim().toLowerCase();
  const byName = (name: string) => scenarios.find((s) => s.name === name) ?? scenarios[0];
  const exact = scenarios.find((s) => s.question.toLowerCase() === q);
  if (exact) return exact;
  if (/ignore|system prompt|instructions/.test(q)) return byName("guard");
  if (/\brag\b|retriev|fine-?tun/.test(q)) return byName("answer");
  if (/evaluat|ship/.test(q)) return byName("wake");
  if (/token|context window|cost/.test(q)) return byName("cut");
  return byName("refusal");
}

/** Wait `ms`, or reject with an AbortError as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A transport that replays `scenarios`. `speed` 2 plays twice as fast; 0 means no waiting. */
export function replayTransport({
  scenarios = SCENARIOS,
  speed = 1,
  pick = (body: AskBody) => pickScenario(body.question, scenarios),
}: { scenarios?: Scenario[]; speed?: number; pick?: (body: AskBody) => Scenario } = {}): ChatTransport & { tries: Map<string, number> } {
  const tries = new Map<string, number>();
  return {
    kind: "replay",
    tries,
    async send(body, onData, signal) {
      const scenario = pick(body);
      const n = tries.get(body.question) ?? 0;
      tries.set(body.question, n + 1);
      const run = scenario.tries[Math.min(n, scenario.tries.length - 1)];
      for (const step of run) {
        const wait = speed > 0 ? step.delayMs / speed : 0;
        if (wait > 0) await sleep(wait, signal);
        else if (signal.aborted) throw new DOMException("aborted", "AbortError");
        if ("fail" in step) throw new TransportError(step.fail.message, step.fail.kind, step.fail.status, step.fail.retryAfterS);
        onData("raw" in step ? step.raw : JSON.stringify(step.event));
      }
    },
  };
}
