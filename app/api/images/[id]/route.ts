import { NextResponse } from "next/server";

import { getImage } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored card image. The id is unguessable; images are public content
// referenced by decks, so this is not gated like the document byte endpoint.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = getImage(id);
  if (!img) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(img.bytes, {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
