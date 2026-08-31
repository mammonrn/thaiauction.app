import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  AuctionPaymentState,
  AuctionStatus,
  PayoutStatus,
  ShippingStatus,
} from "@/generated/prisma/enums";

/**
 * A seller's own work, and their own money.
 *
 * The page this feeds used to be a list of listings, which answers "what have I
 * got" — a question a seller can answer from memory. The question they actually
 * open it with is "what needs me today", and that is a different shape: an
 * order somebody has paid for and is waiting on is urgent, an auction running
 * by itself is not, and money already sent is neither.
 *
 * NO NEW COLUMN. Every stage below is derived from three facts the marketplace
 * already keeps — the auction's status, its payment state, and whether the
 * seller says they have posted it — plus, for the last two, whether the payout
 * has gone out. A stored "seller stage" would be a fourth fact to keep in step
 * with the other three, and the first sweep that forgot to update it would have
 * the dashboard lying to the person whose money it is about.
 *
 * THE MONEY IS READ, NEVER RECOMPUTED. `amount`, `fee`, `feeVat`, `commission`
 * and `sellerNet` were written onto the payment row from the Omise charge at
 * the moment it settled — Omise's own numbers, which vary by method and by card
 * — so a page that worked the VAT back out of the amount at 7% would quietly
 * disagree with what was really taken out of this seller's money. This is the
 * same rule lib/sales-report.ts follows, for the same reason, and
 * scripts/seller-dashboard.test.mts pins it with figures that deliberately do
 * not satisfy the formula.
 */

/**
 * Where one of the seller's items stands.
 *
 *   live             — running; nothing to do but wait
 *   awaiting_payment — it ended and the winner's deadline is running
 *   failed           — nobody paid and there is nobody left to hand it to. The
 *                      seller decides what happens next: see lib/failed-deal.ts
 *   to_ship          — PAID and not posted. The only stage where somebody is
 *                      waiting on the seller, so it is the one the page leads on
 *   awaiting_payout  — posted; the marketplace still has the money
 *   done             — posted and paid out
 *
 * Null for everything else: a draft, a cancelled listing, and an auction that
 * ended with no bids at all. None of those is a stage of a sale, and counting
 * them as one would put "จบดีล" on an item that never sold.
 */
export type SellerStage =
  | "live"
  | "awaiting_payment"
  | "failed"
  | "to_ship"
  | "awaiting_payout"
  | "done";

export function sellerStage(item: {
  status: AuctionStatus;
  paymentState: AuctionPaymentState;
  shippingStatus: ShippingStatus;
  /** The settled payment's payout state, or null when nothing settled. */
  payoutStatus: PayoutStatus | null;
}): SellerStage | null {
  // Paid comes first, because it is a fact about money and outranks whatever
  // the auction's own status says. An item that was paid for is past bidding.
  if (item.paymentState === "paid") {
    if (item.shippingStatus === "not_shipped") return "to_ship";
    return item.payoutStatus === "transferred" ? "done" : "awaiting_payout";
  }

  // A winner who let the deadline pass hands the right to the next bidder and
  // the state goes back to awaiting_payment; a strike is written and the item
  // is emphatically NOT waiting to be posted. That falls out of reading
  // paymentState rather than "has a payment row".
  if (item.paymentState === "awaiting_payment") return "awaiting_payment";

  // Every bidder in turn let their deadline pass and lib/bidding.ts ran out of
  // people to offer it to. Waiting on the seller now — and until this stage
  // existed, waiting on nobody at all.
  if (item.status === "ended" && item.paymentState === "unpaid") return "failed";

  if (item.status === "active") return "live";

  return null;
}

export const STAGE_LABEL: Record<SellerStage, string> = {
  live: "กำลังประมูล",
  awaiting_payment: "รอผู้ชนะจ่าย",
  failed: "ดีลล้ม รอตัดสินใจ",
  to_ship: "จ่ายแล้ว รอเราส่ง",
  awaiting_payout: "ส่งแล้ว รอเงินเข้า",
  done: "จบดีล",
};

/** The order they are shown in: the seller's own work first, then waiting. */
export const STAGE_ORDER: SellerStage[] = [
  "to_ship",
  "failed",
  "awaiting_payment",
  "live",
  "awaiting_payout",
  "done",
];

export type StageCounts = Record<SellerStage, number>;

export type SellerEarnings = {
  /** How many settled sales the figures come from. */
  count: number;
  /** Σ amount — what buyers paid. */
  sales: number;
  /** Σ fee — Omise's charge, before its VAT. */
  omiseFee: number;
  /** Σ feeVat. */
  omiseVat: number;
  /** The two together. */
  omiseTotal: number;
  /**
   * Σ transferFee — Omise's fee for MOVING the money, where the automatic
   * payout path recorded one. Null-summed to 0 on the manual path, which is
   * why it is shown only when there is something to show: a zero line would
   * suggest a deduction that did not happen.
   */
  transferFee: number;
  /** Σ commission — the platform's share. */
  commission: number;
  /** Σ sellerNet — what the seller actually receives. */
  net: number;
  /** Of that, what is still with the marketplace... */
  awaitingPayout: number;
  /** ...and what has been sent. */
  paidOut: number;
};

export type SellerDashboard = {
  stages: StageCounts;
  /** The live auction closing soonest, for the one line that says "next". */
  closingSoon: { id: string; title: string; endTime: Date } | null;
  /** Everything settled, ever. */
  earnings: SellerEarnings;
  /** The same figures over the last 30 days. */
  last30: SellerEarnings;
  /** Whether this account has ever listed anything at all. */
  hasListings: boolean;
};

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

const EMPTY_EARNINGS: SellerEarnings = {
  count: 0,
  sales: 0,
  omiseFee: 0,
  omiseVat: 0,
  omiseTotal: 0,
  transferFee: 0,
  commission: 0,
  net: 0,
  awaitingPayout: 0,
  paidOut: 0,
};

/**
 * The whole dashboard, for one seller.
 *
 * Scoped by `sellerId` in every query — there is no "all sellers" path through
 * this file, so a page that forgot to pass an id would not compile rather than
 * quietly showing somebody else's money.
 */
export async function sellerDashboard(
  sellerId: string,
  now = new Date(),
): Promise<SellerDashboard> {
  const since = new Date(now.getTime() - DAYS_30);

  const [items, settled] = await Promise.all([
    prisma.auctionItem.findMany({
      where: { sellerId },
      select: {
        id: true,
        title: true,
        status: true,
        paymentState: true,
        shippingStatus: true,
        endTime: true,
      },
    }),
    // One row per settled payment of this seller's, so a stage can ask what
    // became of the money without a query per item.
    prisma.payment.findMany({
      where: { auctionItem: { sellerId }, status: "successful" },
      select: { auctionItemId: true, payoutStatus: true },
    }),
  ]);

  const payoutByItem = new Map(
    settled.map((payment) => [payment.auctionItemId, payment.payoutStatus]),
  );

  const stages: StageCounts = {
    live: 0,
    awaiting_payment: 0,
    failed: 0,
    to_ship: 0,
    awaiting_payout: 0,
    done: 0,
  };

  let closingSoon: SellerDashboard["closingSoon"] = null;

  for (const item of items) {
    const stage = sellerStage({
      status: item.status,
      paymentState: item.paymentState,
      shippingStatus: item.shippingStatus,
      payoutStatus: payoutByItem.get(item.id) ?? null,
    });
    if (!stage) continue;
    stages[stage] += 1;

    // "Soonest" means soonest still to come. An auction whose clock has run out
    // but which has not been settled yet is not the one to put in front of a
    // seller as their next deadline.
    if (
      stage === "live" &&
      item.endTime &&
      item.endTime.getTime() > now.getTime() &&
      (!closingSoon || item.endTime < closingSoon.endTime)
    ) {
      closingSoon = { id: item.id, title: item.title, endTime: item.endTime };
    }
  }

  const [earnings, last30] = await Promise.all([
    earningsFor(sellerId, null),
    earningsFor(sellerId, since),
  ]);

  return {
    stages,
    closingSoon,
    earnings,
    last30,
    hasListings: items.length > 0,
  };
}

/**
 * What settled, added up from what was stored.
 *
 * Summed in the database rather than by pulling every payment into memory: a
 * seller's history only grows, and the alternative works right up until
 * somebody succeeds at selling.
 */
async function earningsFor(
  sellerId: string,
  since: Date | null,
): Promise<SellerEarnings> {
  const where = {
    auctionItem: { sellerId },
    status: "successful" as const,
    ...(since ? { paidAt: { gte: since } } : {}),
  };

  const [totals, pending, sent] = await Promise.all([
    prisma.payment.aggregate({
      where,
      _sum: {
        amount: true,
        fee: true,
        feeVat: true,
        transferFee: true,
        commission: true,
        sellerNet: true,
      },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { ...where, payoutStatus: "pending" },
      _sum: { sellerNet: true },
    }),
    prisma.payment.aggregate({
      where: { ...where, payoutStatus: "transferred" },
      _sum: { sellerNet: true },
    }),
  ]);

  if (totals._count._all === 0) return EMPTY_EARNINGS;

  const omiseFee = totals._sum.fee ?? 0;
  const omiseVat = totals._sum.feeVat ?? 0;

  return {
    count: totals._count._all,
    sales: totals._sum.amount ?? 0,
    omiseFee,
    omiseVat,
    omiseTotal: omiseFee + omiseVat,
    transferFee: totals._sum.transferFee ?? 0,
    commission: totals._sum.commission ?? 0,
    net: totals._sum.sellerNet ?? 0,
    awaitingPayout: pending._sum.sellerNet ?? 0,
    paidOut: sent._sum.sellerNet ?? 0,
  };
}
