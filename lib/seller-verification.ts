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
