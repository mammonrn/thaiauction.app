import { readFile, stat } from "node:fs/promises";

import { isCurrentUserAdmin } from "@/lib/admin";
import { kycKeyOwner, resolveKycKey } from "@/lib/kyc-storage";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Serve an identity document.
 *
 * Separate from /api/images on purpose: that route serves public product photos
 * with a year-long immutable cache, and nothing about it should ever be able to
 * reach an ID card.
 *
 * Two principals may read a document: the person it belongs to, and an
 * administrator reviewing it. Everyone else gets 404 — not 403 — so a wrong
 * guess cannot even confirm that a document exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join("/");

  const full = resolveKycKey(key);
  const owner = kycKeyOwner(key);
  if (!full || !owner) {
    return new Response("Not found", { status: 404 });
  }

  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });

  const isOwner = session.user.id === owner;
  const isAdmin = !isOwner && (await isCurrentUserAdmin());

  if (!isOwner && !isAdmin) {
    return new Response("Not found", { status: 404 });
  }

  // The key alone is not authority: the document must still be attached to a
  // live submission. Once a decision is made the row's documentKey is cleared,
  // so an old key stops resolving even if the file lingered somehow.
  const attached = await prisma.sellerVerification.findFirst({
    where: { documentKey: key },
    select: { id: true },
  });
  if (!attached) return new Response("Not found", { status: 404 });

  try {
    const info = await stat(full);
    if (!info.isFile()) return new Response("Not found", { status: 404 });

    const body = await readFile(full);

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(info.size),
        // Never cached anywhere: not by the browser, not by a proxy.
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
        // Keep it out of any referrer sent onward.
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
