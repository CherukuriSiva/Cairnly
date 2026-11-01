import type { Metadata } from "next";
import { Chat } from "@/components/chat/Chat";
import { getTracks } from "@/lib/syllabus";

export const metadata: Metadata = {
  title: "Ask cairnly",
  description: "Ask about the AI engineering lessons. Every answer cites the lessons it comes from.",
};

// The chat. Track titles come from syllabus.yaml at build time, for the "Scoped to <track>"
// chip when a lesson's "Ask cairnly" link opens the chat.
export default function AskPage() {
  const trackTitles = Object.fromEntries(getTracks().map((t) => [t.id, t.title]));
  return <Chat trackTitles={trackTitles} />;
}
