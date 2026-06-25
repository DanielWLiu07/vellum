import type { Metadata } from "next";

import { PdfViewer } from "@/components/pdf-viewer";

export const metadata: Metadata = {
  title: "Document viewer",
  robots: { index: false, follow: false },
};

// The embeddable surface. The host app frames this URL with a signed token in
// the fragment: /embed#t=<token>&mode=slides
export default function EmbedPage() {
  return <PdfViewer />;
}
