import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { findShillLink, type ShillLink } from "@/lib/anti-shill";
import {
  checkBidAmount,
  isBuyNowBid,
  minimumBid,
  paymentDeadline,
} from "@/lib/auction-rules";
import { prisma } from "@/lib/prisma";
import { countStrikes, STRIKE_LIMIT } from "@/lib/strikes";

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
        | "not_an_amount"
        | "banned"
        | "shill";
      minimum?: number;
      buyNowPrice?: number | null;
      strikes?: number;
      shillLink?: ShillLink;
    };

/**
 * Where a bid came from. Recorded against the bid so an admin can later spot
 * several accounts bidding from one machine on one seller's items.
 */
export type BidOrigin = {
  ipAddress: string | null;
  userAgent: string | null;
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
  origin: BidOrigin = { ipAddress: null, userAgent: null },
): Promise<PlaceBidResult> {
  // Who the bidder IS, checked before the transaction opens.
  //
  // These two questions — is this account banned, and is it the seller under
  // another name — need several queries each, and none of them can be answered
  // any better by holding the auction's row lock while asking. Doing them here
  // keeps the lock down to the price arithmetic that genuinely races. An
  // auction's seller never changes, so reading it beforehand is sound; and a
  // ban that lands microseconds later costs at most one extra bid, which is a
  // fairness question rather than a correctness one.
  const preCheck = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true },
  });
  if (!preCheck) return { ok: false, reason: "not_found" } as const;

  const strikes = await countStrikes(bidderId);
  if (strikes >= STRIKE_LIMIT) {
    return { ok: false, reason: "banned", strikes } as const;
  }

  const shillLink = await findShillLink(bidderId, preCheck.sellerId);
  if (shillLink) {
    return { ok: false, reason: "shill", shillLink } as const;
  }

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
      data: {
        auctionItemId: itemId,
        bidderId,
        amount,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      },
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
              paymentState: "awaiting_payment" as const,
              paymentDueAt: paymentDeadline(new Date()),
            }
          : {}),
      },
    });

    return { ok: true, wonByBuyNow, amount } as const;
  });
}

export type BuyNowResult =
  | { ok: true; amount: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_active"
        | "expired"
        | "own_item"
        | "no_buy_now"
        | "banned"
        | "shill";
      strikes?: number;
      shillLink?: ShillLink;
    };

/**
 * Buy the item outright at its buy-now price.
 *
 * Everything this does, `placeBid` could already do — bid exactly the buy-now
 * amount and `isBuyNowBid` ends the auction. It exists as its own entry point
 * for two reasons, both of which are about what the caller is NOT allowed to
 * decide.
 *
 * The price is never sent by the client. It is read from the locked row and
 * used as-is, so a stale tab showing yesterday's buy-now price cannot buy at
 * yesterday's price: there is no amount in the request to be stale.
 *
 * And the current leader is allowed through. `placeBid` refuses them with
 * `already_leading`, which is right for bidding — raising your own price only
 * costs you money — but wrong here, because closing the auction before someone
 * outbids you is the whole point of the button.
 *
 * Concurrency is the same story as bidding, deliberately: the same row lock,
 * taken the same way. A bid and a buy-now landing together are serialised by
 * PostgreSQL on that row, so the second one reads what the first committed. If
 * the buy-now went first the bid finds the auction `ended` and is refused; if
 * the bid went first the sale still completes, at the buy-now price, which the
 * bid cannot have exceeded.
 */
export async function buyNow(
  itemId: string,
  buyerId: string,
  origin: BidOrigin = { ipAddress: null, userAgent: null },
): Promise<BuyNowResult> {
  // Identical pre-checks to placeBid, for the identical reason: they need
  // several queries each and none of them is better answered while holding the
  // auction's row lock. Buying outright is a bid that wins immediately, so the
  // same bans and the same shill rules apply.
  const preCheck = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true },
  });
  if (!preCheck) return { ok: false, reason: "not_found" } as const;

  const strikes = await countStrikes(buyerId);
  if (strikes >= STRIKE_LIMIT) {
    return { ok: false, reason: "banned", strikes } as const;
  }

  const shillLink = await findShillLink(buyerId, preCheck.sellerId);
  if (shillLink) {
    return { ok: false, reason: "shill", shillLink } as const;
  }

  return prisma.$transaction(async (tx) => {
    const item = await lockAuction(tx, itemId);
    if (!item) return { ok: false, reason: "not_found" } as const;

    if (item.sellerId === buyerId) {
      return { ok: false, reason: "own_item" } as const;
    }
    if (item.status !== "active") {
      return { ok: false, reason: "not_active" } as const;
    }
    if (item.endTime && item.endTime.getTime() <= Date.now()) {
      await settleLocked(tx, item, "expired");
      return { ok: false, reason: "expired" } as const;
    }
    if (item.buyNowPrice === null) {
      return { ok: false, reason: "no_buy_now" } as const;
    }

    const amount = item.buyNowPrice;
    const now = new Date();

    // Recorded as a bid like any other win, so the auction's history shows what
    // the item sold for and forfeitAndReoffer can still find the underbidders.
    //
    // The unique index on (auctionItemId, amount) would refuse a second bid at
    // this amount, but it cannot fire here: a bid at the buy-now price ends the
    // auction, so any transaction arriving second finds `ended` above and stops
    // before reaching this line. The index stays as the backstop it was.
    await tx.bid.create({
      data: {
        auctionItemId: itemId,
        bidderId: buyerId,
        amount,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      },
    });

    await tx.auctionItem.update({
      where: { id: itemId },
      data: {
        currentPrice: amount,
        status: "ended",
        endedAt: now,
        endReason: "buy_now",
        winnerId: buyerId,
        paymentState: "awaiting_payment",
        paymentDueAt: paymentDeadline(now),
      },
    });

    return { ok: true, amount } as const;
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

  const now = new Date();

  await tx.auctionItem.update({
    where: { id: item.id },
    data: {
      status,
      endedAt: now,
      endReason:
        status === "cancelled" ? "seller_cancelled" : reason,
      winnerId: top?.bidderId ?? null,
      // The winner's clock starts the moment the auction closes. With no
      // winner there is nothing to collect, so no clock runs.
      ...(top
        ? {
            paymentState: "awaiting_payment" as const,
            paymentDueAt: paymentDeadline(now),
          }
        : {
            paymentState: "not_applicable" as const,
            paymentDueAt: null,
          }),
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

/**
 * The winner let their deadline pass: record a strike and offer the item on.
 *
 * Runs under the same row lock bidding uses, so it cannot race a payment that
 * is landing at the same moment — the payment path takes the lock too, and
 * whichever gets there first wins. If the payment got there first the auction
 * is already `paid` and this does nothing.
 *
 * The item is offered to the next highest bidder AT THEIR OWN BID, not at the
 * forfeited price. They never offered the higher number, so charging it would
 * invent a bid nobody made. `currentPrice` moves down with the offer.
 *
 * Skipped when choosing the next holder:
 *   - anyone who already forfeited this auction (their strike row is the
 *     record of that, so the chain can never loop back to them);
 *   - anyone banned, since three missed deadlines is reason enough not to
 *     spend another 24 hours waiting on them.
 */
export type ForfeitResult = {
  struckUserId: string | null;
  nextWinnerId: string | null;
};

export async function forfeitAndReoffer(
  itemId: string,
): Promise<ForfeitResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        winnerId: string | null;
        currentPrice: number;
        paymentState: string;
      }[]
    >`
      SELECT id, "winnerId", "currentPrice", "paymentState"
      FROM auction_items
      WHERE id = ${itemId}
      FOR UPDATE
    `;
    const item = rows[0];

    // Already paid, already exhausted, or never had a winner.
    if (!item || item.paymentState !== "awaiting_payment" || !item.winnerId) {
      return { struckUserId: null, nextWinnerId: null };
    }

    // The strike. Unique on (userId, auctionItemId), so a sweep that runs twice
    // over the same lapsed deadline cannot punish the same person twice.
    await tx.paymentStrike.upsert({
      where: {
        userId_auctionItemId: {
          userId: item.winnerId,
          auctionItemId: item.id,
        },
      },
      create: {
        userId: item.winnerId,
        auctionItemId: item.id,
        amount: item.currentPrice,
      },
      update: {},
    });

    const forfeited = await tx.paymentStrike.findMany({
      where: { auctionItemId: item.id },
      select: { userId: true },
    });
    const forfeitedIds = forfeited.map((row) => row.userId);

    // Everyone banned, so they can be skipped in the same pass.
    const banned = await tx.paymentStrike.groupBy({
      by: ["userId"],
      _count: { userId: true },
      having: { userId: { _count: { gte: STRIKE_LIMIT } } },
    });
    const bannedIds = banned.map((row) => row.userId);

    const next = await tx.bid.findFirst({
      where: {
        auctionItemId: item.id,
        bidderId: { notIn: [...new Set([...forfeitedIds, ...bannedIds])] },
      },
      orderBy: { amount: "desc" },
      select: { bidderId: true, amount: true },
    });

    if (!next) {
      // Nobody left to offer it to.
      await tx.auctionItem.update({
        where: { id: item.id },
        data: {
          winnerId: null,
          paymentState: "unpaid",
          paymentDueAt: null,
        },
      });
      return { struckUserId: item.winnerId, nextWinnerId: null };
    }

    const now = new Date();
    await tx.auctionItem.update({
      where: { id: item.id },
      data: {
        winnerId: next.bidderId,
        currentPrice: next.amount,
        paymentState: "awaiting_payment",
        paymentDueAt: paymentDeadline(now),
      },
    });

    return { struckUserId: item.winnerId, nextWinnerId: next.bidderId };
  });
}

/**
 * Sweep every payment deadline that has passed.
 *
 * The counterpart to settleAllExpired, and run from the same script for the
 * same reason: most state changes happen lazily when someone looks at a page,
 * but a deadline that lapses at 3am with nobody watching must still move the
 * item on to the next bidder.
 *
 * Each auction gets its own transaction so one failure cannot roll back the
 * rest of the batch.
 */
export async function sweepPaymentDeadlines(): Promise<string[]> {
  const due = await prisma.auctionItem.findMany({
    where: {
      paymentState: "awaiting_payment",
      paymentDueAt: { not: null, lte: new Date() },
    },
    select: { id: true },
  });

  const moved: string[] = [];
  for (const { id } of due) {
    const result = await forfeitAndReoffer(id);
    if (result.struckUserId) moved.push(id);
  }
  return moved;
}
