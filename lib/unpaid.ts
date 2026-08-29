import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * How many auctions this person has won and not yet paid for.
 *
 * Drives the dot on "ประมูลของฉัน". A missed payment deadline costs the buyer
 * the item AND earns them a strike, so an unpaid win is the one thing in this
 * app worth interrupting someone about.
 *
 * `awaiting_payment` alone is the right test: the deadline sweep moves a lapsed
 * offer on to the next bidder and clears winnerId, so an expired obligation
 * stops counting by itself rather than needing a date comparison here.
 */
export async function unpaidWinCount(userId: string): Promise<number> {
  return prisma.auctionItem.count({
    where: { winnerId: userId, paymentState: "awaiting_payment" },
  });
}
