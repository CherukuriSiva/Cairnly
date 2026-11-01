// Reading progress kept in this browser only: which lessons are done and which checklist items
// are ticked, under one versioned localStorage key:
//   { "done": ["<track>/<slug>", ...], "checks": { "<track>/<slug>": [<ticked item indexes>] } }
// The pure functions below are tested; the store under them never throws (blocked or corrupt
// storage falls back to memory) and follows other tabs through the `storage` event.

export const PROGRESS_KEY = "cairnly.progress.v1";

export interface Progress {
  done: string[];
  checks: Record<string, number[]>;
}

export const EMPTY_PROGRESS: Progress = Object.freeze({ done: [], checks: {} }) as Progress;

export function lessonKey(track: string, slug: string): string {
  return `${track}/${slug}`;
}

const isIndex = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** Progress from the stored text. Anything missing, corrupt or of the wrong shape reads as
 * nothing done; bad entries are dropped one by one. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return EMPTY_PROGRESS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (!data || typeof data !== "object") return EMPTY_PROGRESS;
  const { done, checks } = data as { done?: unknown; checks?: unknown };
  const doneList = Array.isArray(done) ? [...new Set(done.filter((d): d is string => typeof d === "string"))] : [];
  const checkMap: Record<string, number[]> = {};
  if (checks && typeof checks === "object" && !Array.isArray(checks)) {
    for (const [key, value] of Object.entries(checks)) {
      if (Array.isArray(value)) checkMap[key] = [...new Set(value.filter(isIndex))].sort((a, b) => a - b);
    }
  }
  return { done: doneList, checks: checkMap };
}

export function serializeProgress(progress: Progress): string {
  return JSON.stringify(progress);
}

export function isDone(progress: Progress, key: string): boolean {
  return progress.done.includes(key);
}

/** Mark a lesson done or not done (`on` defaults to the opposite of now). */
export function setDone(progress: Progress, key: string, on: boolean = !isDone(progress, key)): Progress {
  if (on === isDone(progress, key)) return progress;
  return { ...progress, done: on ? [...progress.done, key] : progress.done.filter((d) => d !== key) };
}

/** Tick or untick one checklist item of a lesson. */
export function setCheck(progress: Progress, key: string, index: number, checked: boolean): Progress {
  const current = progress.checks[key] ?? [];
  if (checked === current.includes(index)) return progress;
  const next = checked ? [...current, index].sort((a, b) => a - b) : current.filter((i) => i !== index);
  return { ...progress, checks: { ...progress.checks, [key]: next } };
}

/** How many of these lesson keys are done. */
export function doneCount(progress: Progress, keys: string[]): number {
  const done = new Set(progress.done);
  return keys.filter((k) => done.has(k)).length;
}

// The browser store, for useSyncExternalStore. The server (and the first client render, during
// hydration) sees EMPTY_PROGRESS.

let cache: Progress | null = null;
const listeners = new Set<() => void>();

function load(): Progress {
  if (cache) return cache;
  try {
    cache = parseProgress(window.localStorage.getItem(PROGRESS_KEY));
  } catch {
    cache = EMPTY_PROGRESS; // storage blocked: keep progress in memory for this page
  }
  return cache;
}

function onStorage(e: StorageEvent) {
  if (e.key !== PROGRESS_KEY && e.key !== null) return;
  cache = null; // another tab changed it: read again
  listeners.forEach((l) => l());
}

export function subscribeProgress(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getProgress(): Progress {
  return load();
}

export function getServerProgress(): Progress {
  return EMPTY_PROGRESS;
}

/** Change the progress, save it if storage allows, and tell every subscriber. */
export function updateProgress(change: (progress: Progress) => Progress): void {
  const next = change(load());
  if (next === cache) return;
  cache = next;
  try {
    window.localStorage.setItem(PROGRESS_KEY, serializeProgress(next));
  } catch {
    // storage full or blocked: the change still holds in memory for this page
  }
  listeners.forEach((l) => l());
}
