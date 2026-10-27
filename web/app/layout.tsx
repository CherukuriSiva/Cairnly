import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cairnly",
  description: "Ask the docs. Get cited answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
