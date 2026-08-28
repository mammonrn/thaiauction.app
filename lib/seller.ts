import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Require a signed-in user who may list an item: phone verified, and the
 * selling terms accepted.
 *
 * Listing an item is where a stranger is asked to send money, so the seller has
 * to be reachable by something better than a throwaway email. Sellers without a
 * verified number are sent to /account/phone with `next`, so they land back
 * here once they finish rather than having to find the page again.
 */
export async function requireVerifiedSeller(returnTo: string) {
  const session = await requireSession(returnTo);

  const verified = await prisma.verifiedPhone.count({
    where: { userId: session.user.id },
  });

  if (verified === 0) {
    redirect(
      `/account/phone?reason=sell&next=${encodeURIComponent(returnTo)}`,
    );
  }

  // The commission is disclosed on the terms page, and a seller is entitled to
  // have seen it before listing. Checked HERE rather than only on /sell/new so
  // the Server Actions that create and publish listings are covered by the
  // same gate — a page check alone would be bypassed by calling the action.
  const { sellerTermsAcceptedAt } = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { sellerTermsAcceptedAt: true },
  });

  if (!sellerTermsAcceptedAt) {
    redirect(`/sell/terms?next=${encodeURIComponent(returnTo)}`);
  }

  return session;
}
