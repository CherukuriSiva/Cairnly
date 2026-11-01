"use client";

// The lesson quiz. lib/anchors.ts (remarkQuiz) marks each option list item with its question
// (`data-quiz-group`), its position (`data-quiz-index`) and, on the right one, `data-correct`;
// the `li` override renders those items as QuizOption buttons. Picking an option locks that
// question and shows right or wrong; each question in a quiz is independent.

import { Check, CircleHelp, X } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { tint } from "@/components/ui/tokens";

interface QuizState {
  picked: Record<number, number>;
  revealed: boolean;
  pick: (group: number, index: number, correct: boolean) => void;
}

const QuizContext = createContext<QuizState | null>(null);

export function MiniQuiz({ anchorId, title, children }: { anchorId?: string; title: string; children?: React.ReactNode }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const pick = (group: number, index: number, correct: boolean) => {
    if (group in picked || revealed) return;
    setPicked((all) => ({ ...all, [group]: index }));
    setAnnouncement(correct ? "Correct." : "Not quite. The correct answer is now marked.");
  };

  return (
    <QuizContext.Provider value={{ picked, revealed, pick }}>
      <section className="quiz my-8 rounded-2xl border border-border bg-surface-1 p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <CircleHelp size={16} aria-hidden="true" className="text-accent" />
          <h2 id={anchorId} className="eyebrow text-xs font-semibold text-accent">
            {title}
          </h2>
        </div>
        <div className="prose prose-sm max-w-none sm:prose-base">{children}</div>
        <div className="mt-3 flex items-center gap-3">
          {!revealed && (
            <button type="button" onClick={() => setRevealed(true)} className="text-sm text-muted underline underline-offset-2 hover:text-text">
              Show answer
            </button>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>
    </QuizContext.Provider>
  );
}

type OptionProps = React.LiHTMLAttributes<HTMLLIElement> & {
  "data-quiz-group"?: string;
  "data-quiz-index"?: string;
  "data-correct"?: string;
};

/** One answer option: a full-width button inside its list item. */
export function QuizOption({ children, "data-quiz-group": group, "data-quiz-index": index, "data-correct": correctAttr }: OptionProps) {
  const quiz = useContext(QuizContext);
  const g = Number(group);
  const i = Number(index);
  const correct = correctAttr === "true";
  const chosen = quiz?.picked[g];
  const locked = chosen !== undefined || Boolean(quiz?.revealed);
  const pickedThis = chosen === i;

  let style: React.CSSProperties | undefined;
  let state: React.ReactNode = null;
  if (locked && correct) {
    style = { background: tint("success"), borderColor: "var(--success)" };
    state = (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
        <Check size={14} aria-hidden="true" /> Correct
      </span>
    );
  } else if (locked && pickedThis) {
    style = { background: tint("hard"), borderColor: "var(--hard)" };
    state = (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-hard">
        <X size={14} aria-hidden="true" /> Not quite
      </span>
    );
  }

  return (
    <li className="quiz-option">
      <button
        type="button"
        aria-disabled={locked}
        onClick={() => quiz?.pick(g, i, correct)}
        className={`flex w-full items-start gap-3 rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-left text-text ${
          locked ? (state ? "" : "opacity-60") : "hover:border-accent"
        }`}
        style={style}
      >
        <span className="min-w-0 flex-1">{children}</span>
        {state}
      </button>
    </li>
  );
}
