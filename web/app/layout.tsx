import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { PaletteHost } from "@/components/site/PaletteHost";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { getTracks } from "@/lib/syllabus";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://cairnly-blond.vercel.app"),
  title: SITE_NAME,
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <div className="page-glow" aria-hidden="true" />
        <Header trackIds={getTracks().map((t) => t.id)} />
        <div className="flex-1">{children}</div>
        <Footer />
        <PaletteHost />
      </body>
    </html>
  );
}
