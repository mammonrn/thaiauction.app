import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { checkBidAmount, isBuyNowBid, minimumBid } from "@/lib/auction-rules";
import { prisma } from "@/lib/prisma";

/**
 * Bidding and settlement.
 *
 * Every mutation runs inside a transaction that first takes a row lock on the
 * auction with SELECT ... FOR UPDATE. That is the whole concurrency story:
 * two simultaneous bids are serialised by PostgreSQL on that row, so the second
 * one reads the price the first one committed rather than the stale price it
 * saw before. Checking currentPrice in application code alone would not do it —
 * both requests would read the same value and both would pass.
 *
 * A unique index on (auctionItemId, amount) backs it up, so even a bug that
 * skipped the lock could not record two bids at the same amount.
 */

/** Locked snapshot of the columns the bidding rules need. */
type LockedAuction = {
  id: string;
  sellerId: string;
  status: "draft" | "active" | "ended" | "cancelled";
  currentPrice: number;
  bidIncrement: number;
  buyNowPrice: number | null;
  endTime: Date | null;
};

/**
 * Lock one auction row for the rest of the transaction.
 *
 * Raw SQL because Prisma has no first-class row-lock API; the id is passed as a
 * parameter, never interpolated.
 */
async function lockAuction(
  tx: Prisma.TransactionClient,
  itemId: string,
): Promise<LockedAuction | null> {
  const rows = await tx.$queryRaw<LockedAuction[]>`
    SELECT id, "sellerId", status, "currentPrice", "bidIncrement",
           "buyNowPrice", "endTime"
    FROM auction_items
    WHERE id = ${itemId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export type PlaceBidResult =
  | { ok: true; wonByBuyNow: boolean; amount: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_active"
        | "expired"
        | "own_item"
        | "already_leading"
        | "below_minimum"
        | "above_buy_now"
        | "not_an_amount";
      minimum?: number;
      buyNowPrice?: number | null;
    };

/**
 * Place a bid.
 *
 * Everything that decides whether the bid is legal is read after the lock is
 * held, so the decision cannot be made on a stale price.
 */
export async function placeBid(
  itemId: string,
  bidderId: string,
  amount: number,
): Promise<PlaceBidResult> {
  return prisma.$transaction(async (tx) => {
    const item = await lockAuction(tx, itemId);
    if (!item) return { ok: false, reason: "not_found" } as const;

    if (item.sellerId === bidderId) {
      return { ok: false, reason: "own_item" } as const;
    }
    if (item.status !== "active") {
      return { ok: false, reason: "not_active" } as const;
    }
    // A bid landing microseconds after the close must not count. Settling here
    // as well keeps the auction from lingering open just because no sweep has
    // run yet.
    if (item.endTime && item.endTime.getTime() <= Date.now()) {
      await settleLocked(tx, item, "expired");
      return { ok: false, reason: "expired" } as const;
    }

    const ctx = {
      currentPrice: item.currentPrice,
      bidIncrement: item.bidIncrement,
      buyNowPrice: item.buyNowPrice,
    };

    const rejection = checkBidAmount(amount, ctx);
    if (rejection) {
      return {
        ok: false,
        reason: rejection,
        minimum: minimumBid(ctx),
        buyNowPrice: item.buyNowPrice,
      } as const;
    }

    // Bidding against yourself just inflates the price you will pay.
    const leader = await tx.bid.findFirst({
      where: { auctionItemId: itemId },
      orderBy: { amount: "desc" },
      select: { bidderId: true },
    });
    if (leader?.bidderId === bidderId) {
      return { ok: false, reason: "already_leading" } as const;
    }

    await tx.bid.create({
      data: { auctionItemId: itemId, bidderId, amount },
    });

    const wonByBuyNow = isBuyNowBid(amount, ctx);

    await tx.auctionItem.update({
      where: { id: itemId },
      data: {
        currentPrice: amount,
        ...(wonByBuyNow
          ? {
              status: "ended" as const,
              endedAt: new Date(),
              endReason: "buy_now" as const,
              winnerId: bidderId,
            }
          : {}),
      },
    });

    return { ok: true, wonByBuyNow, amount } as const;
  });
}

/**
 * Close an already-locked auction and record the outcome.
 *
 * The winner is whoever holds the highest bid at this moment; with no bids
 * there is no winner. Only ever called with the row lock held.
 */
async function settleLocked(
  tx: Prisma.TransactionClient,
  item: LockedAuction,
  reason: "expired" | "seller_ended" | "seller_cancelled",
): Promise<{ winnerId: string | null }> {
  const top = await tx.bid.findFirst({
    where: { auctionItemId: item.id },
    orderBy: { amount: "desc" },
    select: { bidderId: true },
  });

  const hasBids = top !== null;

  // A seller closing an auction nobody bid on is a withdrawal, not a sale, so
  // it is cancelled rather than ended.
  const status =
    reason === "seller_cancelled" || (reason === "seller_ended" && !hasBids)
      ? ("cancelled" as const)
      : ("ended" as const);

  await tx.auctionItem.update({
    where: { id: item.id },
    data: {
      status,
      endedAt: new Date(),
      endReason:
        status === "cancelled" ? "seller_cancelled" : reason,
      winnerId: top?.bidderId ?? null,
    },
  });

  return { winnerId: top?.bidderId ?? null };
}

export type EndAuctionResult =
  | { ok: true; status: "ended" | "cancelled"; winnerId: string | null }
  | { ok: false; reason: "not_found" | "not_active" };

/**
 * Seller closes their own auction early.
 *
 * Ownership is part of the lookup, so another user's id simply does not match.
 * Works for both timed and open-ended auctions.
 */
export async function endAuctionBySeller(
  itemId: string,
  sellerId: string,
): Promise<EndAuctionResult> {
  return prisma.$transaction(async (tx) => {
    const item = await lockAuction(tx, itemId);
    if (!item || item.sellerId !== sellerId) {
      return { ok: false, reason: "not_found" } as const;
    }
    if (item.status !== "active") {
      return { ok: false, reason: "not_active" } as const;
    }

    const { winnerId } = await settleLocked(tx, item, "seller_ended");
    return {
      ok: true,
      status: winnerId ? ("ended" as const) : ("cancelled" as const),
      winnerId,
    } as const;
  });
}

/**
 * Settle one auction if its time has passed. Cheap no-op otherwise.
 *
 * Called when an auction is read, so a page view is enough to close an auction
 * whose clock ran out.
 */
export async function settleIfExpired(itemId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const item = await lockAuction(tx, itemId);
    if (
      !item ||
      item.status !== "active" ||
      !item.endTime ||
      item.endTime.getTime() > Date.now()
    ) {
      return false;
    }

    await settleLocked(tx, item, "expired");
    return true;
  });
}

/**
 * Settle every auction whose time has passed.
 *
 * Used by scripts/settle-auctions.ts. Each auction is settled in its own
 * transaction so one failure cannot roll back the rest, and so a long sweep
 * never holds a lock across the whole batch.
 */
export async function settleAllExpired(): Promise<string[]> {
  const due = await prisma.auctionItem.findMany({
    where: { status: "active", endTime: { not: null, lte: new Date() } },
    select: { id: true },
  });

  const settled: string[] = [];
  for (const { id } of due) {
    if (await settleIfExpired(id)) settled.push(id);
  }
  return settled;
}
