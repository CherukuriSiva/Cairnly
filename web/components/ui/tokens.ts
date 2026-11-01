// Small style helpers over the design tokens in app/globals.css.

/** A semantic token names one of the colour variables (--accent, --info, --hard, ...). */
export type Tone =
  | "accent"
  | "accent-strong"
  | "success"
  | "warning"
  | "info"
  | "interview"
  | "easy"
  | "medium"
  | "hard"
  | "muted"
  | "faint";

/** A tinted background of a token: 12% in dark mode, 10% in light (the --tint variable). */
export function tint(tone: Tone, strength = "var(--tint)"): string {
  return `color-mix(in srgb, var(--${tone}) ${strength}, transparent)`;
}

/** The difficulty values the content uses, as tones. Unknown values read as neutral. */
export function difficultyTone(difficulty: string): Tone {
  return difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : "faint";
}
