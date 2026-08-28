import { prisma } from "@/lib/prisma";

/**
 * Has this seller passed the identity check?
 *
 * Derived from the verification rows rather than a flag on `users`, so there is
 * one source of truth and no field that can drift out of step with the audit
 * trail.
 */
export async function isSellerVerified(userId: string): Promise<boolean> {
  const approved = await prisma.sellerVerification.count({
    where: { userId, status: "approved" },
  });
  return approved > 0;
}

/**
 * An approved seller whose name and date of birth were never recorded.
 *
 * These accounts passed KYC before the marketplace collected the reference
 * data a reviewer now compares an ID card against. Their card image was erased
 * on approval, as the retention policy requires, so nothing can be checked
 * retrospectively — the only way to obtain trustworthy identity data is to ask
 * them to submit again.
 *
 * It matters beyond tidiness: the anti-shill check compares a bidder's name
 * and date of birth against the seller's, and a seller with none silently
 * passes a check that was meant to catch them.
 */
export async function needsIdentityResubmission(
  userId: string,
): Promise<boolean> {
  if (!(await isSellerVerified(userId))) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, dateOfBirth: true },
  });

  return !user?.firstName || !user.lastName || !user.dateOfBirth;
}
