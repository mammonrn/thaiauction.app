import "server-only";

import { headers } from "next/headers";

import type { BidOrigin } from "@/lib/bidding";

/**
 * Where the current request came from.
 *
 * Recorded against bids so an admin can spot several accounts bidding from one
 * machine on one seller's items — see app/admin/fraud. It is NOT used to block
 * anything automatically: a household shares a router, so a shared address is a
 * question for a person, not an answer.
 *
 * The app sits behind a reverse proxy on a single VPS, so the client address is
 * the FIRST entry in X-Forwarded-For (the proxy appends, so later entries are
 * hops closer to us). This is trusted only because the proxy in front of this
 * app rewrites the header; it would be forgeable if the app were exposed
 * directly, which is worth remembering if the deployment ever changes.
 */
export async function requestOrigin(): Promise<BidOrigin> {
  const h = await headers();

  const forwarded = h.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;

  // Truncated: a User-Agent is a fingerprint, not a document, and an unbounded
  // one from a hostile client has no business sitting in the database.
  const userAgent = h.get("user-agent")?.slice(0, 400) ?? null;

  return { ipAddress: ipAddress || null, userAgent };
}
