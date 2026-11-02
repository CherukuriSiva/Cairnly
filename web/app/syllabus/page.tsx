import type { Metadata } from "next";
import { SyllabusBrowser } from "@/components/syllabus/SyllabusBrowser";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getTracks, trackSummary } from "@/lib/syllabus";
import { pageTitle, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Syllabus"),
  description: `Six tracks and every ${SITE_NAME} lesson in reading order, from ML foundations to AI systems, DSA, full-stack and career.`,
};

export default function SyllabusPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <SectionHeader
        eyebrow="Learn"
        title="Syllabus"
        description={`Six tracks for new graduates who want to become AI engineers. Start with ML Foundations if machine learning is new to you, or jump to the track you need. Every lesson is open to read, and Ask ${SITE_NAME} answers questions with links back to them.`}
        className="mb-10"
      />
      <SyllabusBrowser tracks={getTracks().map(trackSummary)} />
    </main>
  );
}
