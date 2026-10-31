import { Chat } from "@/components/Chat";
import { getTracks } from "@/lib/syllabus";

// The chat home page. Track titles come from syllabus.yaml at build time, for the
// "Scoped to <track>" chip when a lesson's "Ask cairnly" link opens the chat.
export default function Home() {
  const trackTitles = Object.fromEntries(getTracks().map((t) => [t.id, t.title]));
  return <Chat trackTitles={trackTitles} />;
}
