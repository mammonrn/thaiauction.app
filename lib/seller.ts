import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Require a signed-in user who has verified at least one phone number.
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

  return session;
}
