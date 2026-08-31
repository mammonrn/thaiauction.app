import "server-only";

import { paymentDeadline, PAYMENT_WINDOW_MS } from "@/lib/auction-rules";
import { biddingBan } from "@/lib/bans";
import { prisma } from "@/lib/prisma";
import { countStrikesFor, STRIKE_LIMIT } from "@/lib/strikes";

/**
 * When a deal falls through, and what the seller can do about it.
 *
 * WHAT ALREADY HAPPENS, and is not changed here. A winner who lets the 24-hour
 * deadline pass is struck by lib/bidding.ts, which then hands the item to the
 * next eligible bidder at that bidder's own price, and keeps doing so until
 * either somebody pays or nobody eligible is left. That chain is the one piece
 * of this system nothing in this file may touch, and it is untouched: no import
 * of it, no change to it, and the strike it records still lands exactly as it
 * did.
 *
 * WHAT WAS MISSING. When the chain runs out, the item is left `ended` with
 * `paymentState: "unpaid"` and no winner — and there it sat. Nobody was told,
 * the seller had no way to offer it to anyone, and the only route back to
 * selling it was to type the whole listing in again from memory. That state is
 * what this file calls a FAILED DEAL, and it is derived rather than stored: it
 * is exactly `status === "ended" && paymentState === "unpaid"`, two columns the
 * settlement path already maintains. A stored flag would be a third fact to
 * keep in step with those two.
 *
 * The seller then has two ways out, and may take only one at a time.
 *
 *   A. Offer it to a bidder who is still eligible, at THEIR OWN BID. They may
 *      decline, or ignore it for 24 hours, and neither costs them anything —
 *      the deal they are being offered is a new one, not an obligation they
 *      took on. If they accept, this file writes the same three fields a normal
 *      win writes and the ordinary payment flow takes over, strike included.
 *   B. List it again, as a new item, with the old one's details filled in. The
 *      old listing keeps its history; nothing is edited or deleted.
 *
 * A NOTE ON REACH. Because lib/bidding.ts exhausts every eligible bidder before
 * an item can reach `unpaid`, in production route A will usually find no
 * candidate and the seller will be offered route B alone. That is a property of
 * the chain, not of this file: the moment the chain is changed to stop and ask
 * the seller instead, route A has candidates and works as written. Everything
 * here is built and tested for both.
 */

/** How long an offer stands. The same 24 hours a winner gets to pay. */
export const OFFER_WINDOW_MS = PAYMENT_WINDOW_MS;

export function offerExpiry(from: Date): Date {
  return new Date(from.getTime() + OFFER_WINDOW_MS);
}

/** The one shape of "this deal fell through", used everywhere. */
export const FAILED_DEAL_WHERE = {
  status: "ended" as const,
  paymentState: "unpaid" as const,
  deletedAt: null,
};

export type OfferCandidate = {
  bidderId: string;
  /** What they bid, in satang. The only part of them the seller is shown. */
  amount: number;
};

export type LiveOffer = {
  id: string;
  bidderId: string;
  amount: number;
  expiresAt: Date;
  createdAt: Date;
};

export type FailedDeal = {
  itemId: string;
  title: string;
  /** The price the forfeited winner had agreed to, for context. */
  lastPrice: number;
  endedAt: Date | null;
  /** The offer currently out, if any. */
  offer: LiveOffer | null;
  /**
   * Who could be offered it next, or null when nobody can be. The seller is
   * shown the AMOUNT only: which of their bidders it is is not theirs to know,
   * and a seller who could see it could go round the marketplace to reach them.
   */
  candidate: OfferCandidate | null;
};

/**
 * Everyone who may NOT be offered this item.
 *
 *   - whoever already forfeited it. Their strike on this item is the record,
 *     and it includes the winner who has just walked away;
 *   - anyone struck out of bidding altogether;
 *   - anyone an admin has banned from bidding — a rule the automatic chain does
 *     not apply, and the reason this cannot simply reuse it;
 *   - the seller, who cannot buy their own item.
 */
async function ineligibleFor(itemId: string, sellerId: string): Promise<Set<string>> {
  const forfeited = await prisma.paymentStrike.findMany({
    where: { auctionItemId: itemId },
    select: { userId: true },
  });

  const out = new Set<string>([sellerId, ...forfeited.map((row) => row.userId)]);
  return out;
}

/**
 * The next bidder who could take this item on, or null.
 *
 * Their own highest bid is the price, because it is the only number they ever
 * agreed to. Bidders are considered from the top down and the first eligible
 * one wins — a banned second place is skipped rather than blocking the third.
 */
export async function offerCandidate(itemId: string): Promise<OfferCandidate | null> {
  const item = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true },
  });
  if (!item) return null;

  const excluded = await ineligibleFor(itemId, item.sellerId);

  // Highest bid per bidder, best first. `distinct` after an ordered read gives
  // one row per person — the top one they ever placed.
  const bids = await prisma.bid.findMany({
    where: { auctionItemId: itemId, bidderId: { notIn: [...excluded] } },
    orderBy: [{ amount: "desc" }],
    distinct: ["bidderId"],
    select: { bidderId: true, amount: true },
  });
  if (bids.length === 0) return null;

  // Strikes in one query for the whole shortlist rather than one per person.
  const strikes = await countStrikesFor(bids.map((bid) => bid.bidderId));

  for (const bid of bids) {
    if ((strikes.get(bid.bidderId) ?? 0) >= STRIKE_LIMIT) continue;
    // An admin ban is per-person and time-boxed, so it is asked one at a time —
    // and only of the few who got this far.
    if (await biddingBan(bid.bidderId)) continue;
    return { bidderId: bid.bidderId, amount: bid.amount };
  }

  return null;
}

/**
 * Every deal of this seller's that fell through and is waiting on them.
 *
 * Scoped by seller in the query, so there is no path through this file that
 * could show one seller another's items.
 */
export async function failedDeals(sellerId: string): Promise<FailedDeal[]> {
  const items = await prisma.auctionItem.findMany({
    where: { sellerId, ...FAILED_DEAL_WHERE },
    orderBy: { endedAt: "desc" },
    select: {
      id: true,
      title: true,
      currentPrice: true,
      endedAt: true,
      secondChanceOffers: {
        where: { status: "offered" },
        select: {
          id: true,
          bidderId: true,
          amount: true,
          expiresAt: true,
          createdAt: true,
        },
      },
    },
  });

  const deals: FailedDeal[] = [];
  for (const item of items) {
    const offer = item.secondChanceOffers[0] ?? null;
    deals.push({
      itemId: item.id,
      title: item.title,
      lastPrice: item.currentPrice,
      endedAt: item.endedAt,
      offer,
      // No point costing a query for a candidate while an offer is already out.
      candidate: offer ? null : await offerCandidate(item.id),
    });
  }
  return deals;
}

/** How many of this seller's deals are waiting on a decision. */
export async function failedDealCount(sellerId: string): Promise<number> {
  return prisma.auctionItem.count({ where: { sellerId, ...FAILED_DEAL_WHERE } });
}

export type OfferResult =
  | { ok: true; offerId: string; bidderId: string; amount: number; expiresAt: Date }
  | {
      ok: false;
      reason: "not_found" | "not_failed" | "offer_live" | "no_candidate";
    };

/**
 * Offer the item to the next eligible bidder.
 *
 * The seller asks for this; nothing here happens on its own. Ownership and the
 * item's state are both re-read inside the write, so a stale page cannot make
 * an offer on something that has since moved on.
 *
 * "One live offer per item" is enforced by the database, not by the check
 * above it: `liveForItemId` is unique and holds the item id only while the
 * offer stands, so two requests racing produce one offer and one refusal.
 */
export async function openSecondChance(
  itemId: string,
  sellerId: string,
  now = new Date(),
): Promise<OfferResult> {
  const item = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: { id: true, sellerId: true, status: true, paymentState: true, deletedAt: true },
  });
  if (!item || item.sellerId !== sellerId) return { ok: false, reason: "not_found" };
  if (
    item.status !== "ended" ||
    item.paymentState !== "unpaid" ||
    item.deletedAt !== null
  ) {
    return { ok: false, reason: "not_failed" };
  }

  const live = await prisma.secondChanceOffer.findUnique({
    where: { liveForItemId: itemId },
    select: { id: true },
  });
  if (live) return { ok: false, reason: "offer_live" };

  const candidate = await offerCandidate(itemId);
  if (!candidate) return { ok: false, reason: "no_candidate" };

  const expiresAt = offerExpiry(now);
  try {
    const offer = await prisma.secondChanceOffer.create({
      data: {
        auctionItemId: itemId,
        bidderId: candidate.bidderId,
        amount: candidate.amount,
        liveForItemId: itemId,
        expiresAt,
      },
      select: { id: true },
    });
    return {
      ok: true,
      offerId: offer.id,
      bidderId: candidate.bidderId,
      amount: candidate.amount,
      expiresAt,
    };
  } catch {
    // The unique index refused it: another request got there first.
    return { ok: false, reason: "offer_live" };
  }
}

export type RespondResult =
  | { ok: true; itemId: string; amount: number; dueAt?: Date }
  | { ok: false; reason: "not_found" | "not_yours" | "closed" | "expired" };

/**
 * Take the offer.
 *
 * Writes the three fields a normal win writes — the winner, the price they bid,
 * and a fresh 24-hour deadline — and then gets out of the way. From here the
 * ordinary payment flow handles everything, including striking this person if
 * THEY do not pay: lib/bidding.ts's deadline sweep sees an ordinary
 * awaiting_payment row and cannot tell it came from here, which is the point.
 */
export async function acceptSecondChance(
  offerId: string,
  userId: string,
  now = new Date(),
): Promise<RespondResult> {
  const offer = await prisma.secondChanceOffer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      bidderId: true,
      status: true,
      amount: true,
      expiresAt: true,
      auctionItemId: true,
      auctionItem: { select: { status: true, paymentState: true, deletedAt: true } },
    },
  });
  if (!offer) return { ok: false, reason: "not_found" };
  // Not "not_found": the person asking is signed in and this is their answer to
  // give or not. Telling them plainly beats a 404 they cannot act on.
  if (offer.bidderId !== userId) return { ok: false, reason: "not_yours" };
  if (offer.status !== "offered") return { ok: false, reason: "closed" };
  if (offer.expiresAt <= now) return { ok: false, reason: "expired" };
  if (
    offer.auctionItem.status !== "ended" ||
    offer.auctionItem.paymentState !== "unpaid" ||
    offer.auctionItem.deletedAt !== null
  ) {
    return { ok: false, reason: "closed" };
  }

  const dueAt = paymentDeadline(now);

  await prisma.$transaction([
    prisma.secondChanceOffer.update({
      where: { id: offer.id, status: "offered" },
      data: { status: "accepted", respondedAt: now, liveForItemId: null },
    }),
    prisma.auctionItem.update({
      where: { id: offer.auctionItemId },
      data: {
        winnerId: offer.bidderId,
        currentPrice: offer.amount,
        paymentState: "awaiting_payment",
        paymentDueAt: dueAt,
      },
    }),
  ]);

  return { ok: true, itemId: offer.auctionItemId, amount: offer.amount, dueAt };
}

/**
 * Turn it down.
 *
 * FREE. No strike, no mark against them, nothing recorded but the fact that
 * they said no — the deal they walked away from was somebody else's, and this
 * was an offer rather than a commitment. The item goes back to waiting on the
 * seller, who can offer it to the next bidder or list it again.
 */
export async function declineSecondChance(
  offerId: string,
  userId: string,
  now = new Date(),
): Promise<RespondResult> {
  const offer = await prisma.secondChanceOffer.findUnique({
    where: { id: offerId },
    select: { id: true, bidderId: true, status: true, amount: true, auctionItemId: true },
  });
  if (!offer) return { ok: false, reason: "not_found" };
  if (offer.bidderId !== userId) return { ok: false, reason: "not_yours" };
  if (offer.status !== "offered") return { ok: false, reason: "closed" };

  await prisma.secondChanceOffer.update({
    where: { id: offer.id, status: "offered" },
    data: { status: "declined", respondedAt: now, liveForItemId: null },
  });

  return { ok: true, itemId: offer.auctionItemId, amount: offer.amount };
}

/**
 * Close every offer whose 24 hours have run out.
 *
 * Run from the same sweep that closes auctions and judges payment deadlines,
 * so there is one cron entry and one place that moves time forward. Nobody is
 * struck: an offer nobody answered is an offer nobody took on.
 *
 * Returns what it closed, so the caller can tell the sellers.
 */
export async function expireSecondChances(
  now = new Date(),
): Promise<{ offerId: string; itemId: string; sellerId: string; itemTitle: string }[]> {
  const due = await prisma.secondChanceOffer.findMany({
    where: { status: "offered", expiresAt: { lte: now } },
    select: {
      id: true,
      auctionItemId: true,
      auctionItem: { select: { title: true, sellerId: true } },
    },
    take: 200,
  });

  const closed: { offerId: string; itemId: string; sellerId: string; itemTitle: string }[] = [];
  for (const offer of due) {
    // One at a time, and guarded on the status, so a sweep racing an answer
    // that is landing right now cannot overwrite it.
    const { count } = await prisma.secondChanceOffer.updateMany({
      where: { id: offer.id, status: "offered" },
      data: { status: "expired", liveForItemId: null },
    });
    if (count === 0) continue;
    closed.push({
      offerId: offer.id,
      itemId: offer.auctionItemId,
      sellerId: offer.auctionItem.sellerId,
      itemTitle: offer.auctionItem.title,
    });
  }
  return closed;
}

/** Offers waiting for this person to answer, newest first. */
export async function offersFor(userId: string, now = new Date()) {
  return prisma.secondChanceOffer.findMany({
    where: { bidderId: userId, status: "offered", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      expiresAt: true,
      auctionItem: { select: { id: true, title: true, images: true } },
    },
  });
}

export type RelistSource = {
  categorySlug: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  title: string;
  description: string;
  startPrice: number;
  buyNowPrice: number | null;
  bidIncrement: number;
  images: string[];
};

/**
 * The old listing, ready to be typed over.
 *
 * Read-only: relisting creates a NEW item through the ordinary listing flow,
 * and the failed one keeps its bids, its strike and its place in the seller's
 * history. Refused while an offer is live, because a seller cannot have the
 * same object promised to a bidder and back on the block at the same time.
 */
export async function relistSource(
  itemId: string,
  sellerId: string,
): Promise<
  | { ok: true; source: RelistSource }
  | { ok: false; reason: "not_found" | "not_failed" | "offer_live" }
> {
  const item = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      paymentState: true,
      deletedAt: true,
      title: true,
      description: true,
      condition: true,
      images: true,
      startPrice: true,
      buyNowPrice: true,
      bidIncrement: true,
      category: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!item || item.sellerId !== sellerId) return { ok: false, reason: "not_found" };
  if (
    item.status !== "ended" ||
    item.paymentState !== "unpaid" ||
    item.deletedAt !== null
  ) {
    return { ok: false, reason: "not_failed" };
  }

  const live = await prisma.secondChanceOffer.findUnique({
    where: { liveForItemId: itemId },
    select: { id: true },
  });
  if (live) return { ok: false, reason: "offer_live" };

  return {
    ok: true,
    source: {
      categorySlug: item.category.slug,
      categoryId: item.category.id,
      categoryName: item.category.name,
      condition: item.condition ?? "",
      title: item.title,
      description: item.description,
      startPrice: item.startPrice,
      buyNowPrice: item.buyNowPrice,
      bidIncrement: item.bidIncrement,
      images: item.images,
    },
  };
}
