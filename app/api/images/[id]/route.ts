import { NextResponse } from "next/server";

import { getImage } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored card image. The id is unguessable (crypto.randomUUID), which
// is what stands in for the access check the document byte endpoint makes.
//
// That argument covers who can REQUEST the bytes. It says nothing about who can
// keep a copy, and the cache header used to say `public, immutable` — so a card
// image from a private deck, or a member's avatar, was a year-long entry in
// every shared cache and CDN between here and the reader, addressable by anyone
// who later learns the URL. `private` keeps it in the one browser that asked,
// which is the same reason app/api/doc/[id]/preview gives for its own header.
// Still a long max-age: the bytes at an id never change, so revalidating buys
// nothing once the right cache holds it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await getImage(id);
  if (!img) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(img.bytes, {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
