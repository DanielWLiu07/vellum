import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vellum — secure document viewer",
  description:
    "A stateless, zero-knowledge secure document viewer microservice. Capability tokens, server-side proxying, watermarking, and download prevention.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
