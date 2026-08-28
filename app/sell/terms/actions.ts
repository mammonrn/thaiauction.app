"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Record that this seller has read the selling terms.
 *
 * Written with the session's own user id, so nobody can accept on another
 * account's behalf. Stamped once and never overwritten: the question is when
 * they FIRST agreed, and re-stamping on a later visit would erase that.
 */
export async function acceptSellerTermsAction(formData: FormData) {
  const { user } = await requireSession("/sell/terms");

  const next = String(formData.get("next") ?? "/sell/new");
  // Only relative single-slash paths, so this cannot become an open redirect.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/sell/new";

  await prisma.user.updateMany({
    where: { id: user.id, sellerTermsAcceptedAt: null },
    data: { sellerTermsAcceptedAt: new Date() },
  });

  redirect(target);
}
