"use client";

import { useEffect } from "react";
import { warmUp } from "@/lib/ask";

/** Wakes the API while the reader is on the home page, so a question asked from the hero box
 * does not wait for a cold container (lib/ask.ts warmUp). */
export function WarmUp() {
  useEffect(() => warmUp(), []);
  return null;
}
