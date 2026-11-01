"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Old shared links asked the chat at /?q=...&track=...; the chat now lives at /ask, so a
 * home page request carrying `q` moves there with the same query string. */
export function AskForwarder() {
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("q")) {
      router.replace(`/ask${window.location.search}`);
    }
  }, [router]);
  return null;
}
