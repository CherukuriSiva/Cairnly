"use client";

// The lesson checklist and "Mark as done". The lesson page wraps its content in LessonScope, so
// the checklist knows which lesson it belongs to; ticks and done state live in lib/progress.ts.
// Ticking every item marks the lesson done (with a small "stone added" moment); unticking never
// undoes a done the reader set by hand.

import { Check, ListChecks } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useProgress } from "@/components/progress/useProgress";
import { CairnMark } from "@/components/ui/Logo";
import { tint } from "@/components/ui/tokens";
import { isDone, setCheck, setDone, updateProgress } from "@/lib/progress";

/** "<track>/<slug>" of the lesson being read, or null outside a lesson. */
const LessonContext = createContext<string | null>(null);

export function LessonScope({ lessonKey, children }: { lessonKey: string; children: React.ReactNode }) {
  return <LessonContext.Provider value={lessonKey}>{children}</LessonContext.Provider>;
}

interface ChecklistState {
  /** Ticked item indexes. */
  checked: number[];
  toggle: (index: number, on: boolean) => void;
  /** The list that holds the checkboxes, to find each box's index in it. */
  container: React.RefObject<HTMLDivElement | null>;
}

const ChecklistContext = createContext<ChecklistState | null>(null);

/** The small moment after the last stone lands: the mark drops in (static under reduced motion). */
function StoneAdded({ show }: { show: boolean }) {
  return (
    <p aria-live="polite" className="flex min-h-7 items-center gap-2 text-sm text-accent">
      {show && (
        <>
          <span className="stone-drop inline-flex text-text">
            <CairnMark size={24} />
          </span>
          Stone added to your cairn
        </>
      )}
    </p>
  );
}

/** "Mark as done" toggle for the lesson in scope, with the stone moment when it turns on. */
export function MarkDone({ celebrate = false }: { celebrate?: boolean }) {
  const lessonKey = useContext(LessonContext);
  const progress = useProgress();
  const [moment, setMoment] = useState(false);
  useEffect(() => setMoment(celebrate), [celebrate]);
  if (!lessonKey) return null;
  const done = isDone(progress, lessonKey);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <button
        type="button"
        aria-pressed={done}
        onClick={() => {
          updateProgress((p) => setDone(p, lessonKey, !done));
          setMoment(!done);
        }}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
          done ? "border-transparent text-accent-ink" : "border-border-strong text-text hover:border-accent"
        }`}
        style={done ? { background: "var(--accent)" } : undefined}
      >
        <Check size={15} aria-hidden="true" />
        {done ? "Done" : "Mark as done"}
      </button>
      <StoneAdded show={moment && done} />
    </div>
  );
}

/** <CompletionChecklist>: the task list in an accent box with "2 of 4", then Mark as done.
 * Outside a lesson the boxes still tick, without saving. */
export function Checklist({ anchorId, title, children }: { anchorId?: string; title: string; children?: React.ReactNode }) {
  const lessonKey = useContext(LessonContext);
  const progress = useProgress();
  const container = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [celebrate, setCelebrate] = useState(false);

  useLayoutEffect(() => {
    setTotal(container.current?.querySelectorAll('input[type="checkbox"]').length ?? 0);
  }, []);

  const checked = lessonKey ? (progress.checks[lessonKey] ?? []) : local;

  const toggle = (index: number, on: boolean) => {
    if (!lessonKey) {
      setLocal((all) => (on ? [...all, index] : all.filter((i) => i !== index)));
      return;
    }
    const allTicked = on && total > 0 && new Set([...checked.filter((i) => i < total), index]).size >= total;
    updateProgress((p) => {
      const next = setCheck(p, lessonKey, index, on);
      return allTicked ? setDone(next, lessonKey, true) : next;
    });
    if (allTicked && !isDone(progress, lessonKey)) setCelebrate(true);
  };

  return (
    <ChecklistContext.Provider value={{ checked, toggle, container }}>
      <section
        className="callout my-8 rounded-r-xl border-l-[3px] px-5 py-5 sm:px-6"
        style={{ borderLeftColor: "var(--accent)", background: tint("accent") }}
      >
        <div className="mb-3 flex items-center gap-2">
          <ListChecks size={16} aria-hidden="true" className="text-accent" />
          <h2 id={anchorId} className="eyebrow text-xs font-semibold text-accent">
            {title}
          </h2>
          {total > 0 && (
            <span className="ml-auto font-mono text-xs text-muted">
              {checked.filter((i) => i < total).length} of {total}
            </span>
          )}
        </div>
        <div ref={container} className="prose prose-sm max-w-none sm:prose-base">
          {children}
        </div>
        <MarkDone celebrate={celebrate} />
      </section>
    </ChecklistContext.Provider>
  );
}

/** `input` override. Inside a checklist a task box follows the saved ticks (its index is its
 * position in the list); elsewhere it keeps its own state. Native checkbox semantics stay. */
export function TaskCheckbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { type, checked, disabled: _disabled, ...rest } = props;
  const list = useContext(ChecklistContext);
  const ref = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(-1);
  const [own, setOwn] = useState(Boolean(checked));
  const [label, setLabel] = useState<string>();

  useLayoutEffect(() => {
    const boxes = list?.container.current?.querySelectorAll('input[type="checkbox"]');
    if (boxes && ref.current) setIndex(Array.prototype.indexOf.call(boxes, ref.current));
    // GFM task boxes have no <label>: name each box after its list item's text.
    setLabel(ref.current?.closest("li")?.textContent?.trim() || undefined);
  }, [list]);

  if (type !== "checkbox") return <input type={type} defaultChecked={checked} {...rest} />;
  const inList = list !== null && index >= 0;
  return (
    <input
      {...rest}
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={inList ? list.checked.includes(index) : own}
      onChange={(e) => (inList ? list.toggle(index, e.target.checked) : setOwn(e.target.checked))}
      className="mr-2 h-4 w-4 cursor-pointer align-middle"
      style={{ accentColor: "var(--accent)" }}
    />
  );
}
