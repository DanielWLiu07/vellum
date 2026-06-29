import type { Metadata } from "next";
import { Figtree, PT_Sans } from "next/font/google";

import "./globals.css";

// A warm, professional type pairing: a geometric display face for headings and
// a humanist sans for body - chosen to sit comfortably inside a teal/maroon
// institutional palette.
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});
const ptSans = PT_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vellum - secure document viewer",
  description:
    "A stateless, zero-knowledge secure document viewer microservice. Capability tokens, server-side proxying, watermarking, and download prevention.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${ptSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
