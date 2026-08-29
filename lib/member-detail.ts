import "server-only";

import { activeBansFor, banHistory, type ActiveBan } from "@/lib/bans";
import { memberRole, type MemberKyc, type MemberRole } from "@/lib/members";
import { prisma } from "@/lib/prisma";
import type {
  AuctionStatus,
  PaymentMethod,
  PaymentStatus,
  PayoutStatus,
  ReferralStatus,
  ShippingStatus,
  TransferStatus,
} from "@/generated/prisma/enums";

/**
 * Everything about one member, on one page.
 *
 * The question this answers is the one an admin actually gets asked: somebody
 * writes in about a bid, a payment, a parcel or a ban, and the admin needs the
 * whole account in front of them rather than four tools open in four tabs.
 *
 * READ ONLY. Nothing here writes, and the page that uses it has no controls:
 * banning belongs to /admin/bans, reviewing an identity to
 * /admin/verifications, sending money to /admin/payouts. A second place to do
 * any of those is a second place for them to drift.
 *
 * It also deliberately reads NOTHING SENSITIVE. No identity photograph, no
 * bank account, no card detail — those live behind the tools that exist to
 * handle them, and a page assembled for convenience is exactly where such
 * things end up being seen by someone who did not need to see them. Where the
 * admin does need one, this page links to the tool instead.
 *
 * Roles come from lib/members.ts rather than from a second definition here, so
 * the badge on this page and the badge on the list can never disagree.
 */

/** How many rows each section shows before it says "and N more". */
export const SECTION_LIMIT = 20;

/** A list that knows how much of itself it is showing. */
export type Capped<T> = {
  rows: T[];
  /** Everything there is, not just what is in `rows`. */
  total: number;
};

/**
 * Where a bid stands.
 *
 *   won     — the auction ended and this account holds it
 *   leading — still running, and this account is on top
 *   outbid  — still running, and it is not
 *   lost    — it ended and went elsewhere
 *
 * Decided from the auction's own state plus its top bid, not from a column: a
 * bid row records what somebody offered, and what became of it is a fact about
 * the auction.
 */
export type BidOutcome = "won" | "leading" | "outbid" | "lost";

export type MemberBid = {
  id: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  createdAt: Date;
  outcome: BidOutcome;
};

export type MemberPurchase = {
  id: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: Date;
  paidAt: Date | null;
  shippingStatus: ShippingStatus;
  trackingNumber: string | null;
};

export type MemberListing = {
  id: string;
  title: string;
  status: AuctionStatus;
  currentPrice: number;
  endTime: Date | null;
  deletedAt: Date | null;
};

export type MemberSale = {
  id: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  /** What the seller is owed, as worked out when the charge settled. */
  sellerNet: number | null;
  paidAt: Date | null;
  payoutStatus: PayoutStatus;
  payoutAt: Date | null;
  transferStatus: TransferStatus | null;
};

export type MemberStrike = {
  id: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  createdAt: Date;
};

export type MemberBanRow = Awaited<ReturnType<typeof banHistory>>[number];

export type MemberReferrer = {
  /** The account that invited this one. */
  id: string;
  name: string;
  code: string;
  status: ReferralStatus;
  signedUpAt: Date;
  verifiedAt: Date | null;
};

export type MemberInvitee = {
  id: string;
  /** The invited account's own id, so the admin can open it in turn. */
  userId: string;
  name: string;
  status: ReferralStatus;
  signedUpAt: Date;
  verifiedAt: Date | null;
};

export type MemberDetail = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  phones: { phone: string; verifiedAt: Date }[];
  role: MemberRole;
  /** The latest identity submission's state, or null if there never was one. */
  kyc: MemberKyc | null;
  kycSubmittedAt: Date | null;
  activeBans: ActiveBan[];
  bans: MemberBanRow[];
  strikes: Capped<MemberStrike>;
  bids: Capped<MemberBid>;
  purchases: Capped<MemberPurchase>;
  listings: Capped<MemberListing>;
  sales: Capped<MemberSale>;
  referredBy: MemberReferrer | null;
  invited: Capped<MemberInvitee>;
};

/**
 * One member, or null when there is no such account.
 *
 * Null rather than a throw, so the page can answer a mistyped id with the same
 * 404 a stranger gets for the whole area — an admin URL that reports "no such
 * user" differently from "not allowed" is a way of asking whether an id
 * exists.
 */
export async function memberDetail(userId: string): Promise<MemberDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      verifiedPhones: {
        orderBy: { verifiedAt: "asc" },
        select: { phone: true, verifiedAt: true },
      },
      // Every submission, like the list: the badge asks whether one was ever
      // approved, the status column asks what happened to the last one.
      sellerVerifications: {
        orderBy: { submittedAt: "desc" },
        select: { status: true, submittedAt: true },
      },
      _count: { select: { bids: true } },
    },
  });

  if (!user) return null;

  const [
    bids,
    bidTotal,
    purchases,
    purchaseTotal,
    listings,
    listingTotal,
    sales,
    saleTotal,
    strikes,
    strikeTotal,
    bans,
    activeBans,
    referredBy,
    invited,
    invitedTotal,
  ] = await Promise.all([
    prisma.bid.findMany({
      where: { bidderId: userId },
      orderBy: { createdAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        auctionItem: {
          select: { id: true, title: true, status: true, winnerId: true },
        },
      },
    }),
    prisma.bid.count({ where: { bidderId: userId } }),

    prisma.payment.findMany({
      where: { payerId: userId },
      orderBy: { createdAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        amount: true,
        status: true,
        method: true,
        createdAt: true,
        paidAt: true,
        auctionItem: {
          select: {
            id: true,
            title: true,
            shippingStatus: true,
            trackingNumber: true,
          },
        },
      },
    }),
    prisma.payment.count({ where: { payerId: userId } }),

    prisma.auctionItem.findMany({
      where: { sellerId: userId },
      orderBy: { createdAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        currentPrice: true,
        endTime: true,
        deletedAt: true,
      },
    }),
    prisma.auctionItem.count({ where: { sellerId: userId } }),

    // Sales are the money side, so they are payments seen from the seller's
    // end — only settled ones, because an abandoned QR is not a sale.
    prisma.payment.findMany({
      where: { auctionItem: { sellerId: userId }, status: "successful" },
      orderBy: { paidAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        amount: true,
        sellerNet: true,
        paidAt: true,
        payoutStatus: true,
        payoutAt: true,
        transferStatus: true,
        auctionItem: { select: { id: true, title: true } },
      },
    }),
    prisma.payment.count({
      where: { auctionItem: { sellerId: userId }, status: "successful" },
    }),

    prisma.paymentStrike.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        auctionItem: { select: { id: true, title: true } },
      },
    }),
    prisma.paymentStrike.count({ where: { userId } }),

    banHistory(userId),
    activeBansFor([userId]),

    prisma.referral.findUnique({
      where: { referredId: userId },
      select: {
        code: true,
        status: true,
        signedUpAt: true,
        verifiedAt: true,
        referrer: { select: { id: true, name: true } },
      },
    }),

    prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { signedUpAt: "desc" },
      take: SECTION_LIMIT,
      select: {
        id: true,
        status: true,
        signedUpAt: true,
        verifiedAt: true,
        referred: { select: { id: true, name: true } },
      },
    }),
    prisma.referral.count({ where: { referrerId: userId } }),
  ]);

  // What became of each bid needs the auction's top bid, which is one query for
  // the whole page rather than one per row.
  const itemIds = [...new Set(bids.map((bid) => bid.auctionItem.id))];
  const topBids =
    itemIds.length === 0
      ? []
      : await prisma.bid.findMany({
          where: { auctionItemId: { in: itemIds } },
          orderBy: [{ auctionItemId: "asc" }, { amount: "desc" }],
          distinct: ["auctionItemId"],
          select: { auctionItemId: true, bidderId: true },
        });
  const topBidderByItem = new Map(
    topBids.map((row) => [row.auctionItemId, row.bidderId]),
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    phones: user.verifiedPhones,
    role: memberRole({
      hasBid: user._count.bids > 0,
      approvedSeller: user.sellerVerifications.some(
        (entry) => entry.status === "approved",
      ),
    }),
    kyc: user.sellerVerifications[0]?.status ?? null,
    kycSubmittedAt: user.sellerVerifications[0]?.submittedAt ?? null,
    activeBans: activeBans.get(userId) ?? [],
    bans,
    strikes: {
      rows: strikes.map((strike) => ({
        id: strike.id,
        itemId: strike.auctionItem.id,
        itemTitle: strike.auctionItem.title,
        amount: strike.amount,
        createdAt: strike.createdAt,
      })),
      total: strikeTotal,
    },
    bids: {
      rows: bids.map((bid) => ({
        id: bid.id,
        itemId: bid.auctionItem.id,
        itemTitle: bid.auctionItem.title,
        amount: bid.amount,
        createdAt: bid.createdAt,
        outcome: bidOutcome({
          userId,
          status: bid.auctionItem.status,
          winnerId: bid.auctionItem.winnerId,
          topBidderId: topBidderByItem.get(bid.auctionItem.id) ?? null,
        }),
      })),
      total: bidTotal,
    },
    purchases: {
      rows: purchases.map((payment) => ({
        id: payment.id,
        itemId: payment.auctionItem.id,
        itemTitle: payment.auctionItem.title,
        amount: payment.amount,
        status: payment.status,
        method: payment.method,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
        shippingStatus: payment.auctionItem.shippingStatus,
        trackingNumber: payment.auctionItem.trackingNumber,
      })),
      total: purchaseTotal,
    },
    listings: { rows: listings, total: listingTotal },
    sales: {
      rows: sales.map((sale) => ({
        id: sale.id,
        itemId: sale.auctionItem.id,
        itemTitle: sale.auctionItem.title,
        amount: sale.amount,
        sellerNet: sale.sellerNet,
        paidAt: sale.paidAt,
        payoutStatus: sale.payoutStatus,
        payoutAt: sale.payoutAt,
        transferStatus: sale.transferStatus,
      })),
      total: saleTotal,
    },
    referredBy: referredBy
      ? {
          id: referredBy.referrer.id,
          name: referredBy.referrer.name,
          code: referredBy.code,
          status: referredBy.status,
          signedUpAt: referredBy.signedUpAt,
          verifiedAt: referredBy.verifiedAt,
        }
      : null,
    invited: {
      rows: invited.map((row) => ({
        id: row.id,
        userId: row.referred.id,
        name: row.referred.name,
        status: row.status,
        signedUpAt: row.signedUpAt,
        verifiedAt: row.verifiedAt,
      })),
      total: invitedTotal,
    },
  };
}

/**
 * What became of one bid.
 *
 * An auction that has not ended is a live position — leading or outbid — and
 * one that has is a result. A cancelled auction never produced a winner, so
 * every bid on it reads as lost rather than as anything more specific.
 */
export function bidOutcome(facts: {
  userId: string;
  status: AuctionStatus;
  winnerId: string | null;
  topBidderId: string | null;
}): BidOutcome {
  if (facts.status === "active" || facts.status === "draft") {
    return facts.topBidderId === facts.userId ? "leading" : "outbid";
  }
  return facts.winnerId === facts.userId ? "won" : "lost";
}

export const BID_OUTCOME_LABEL: Record<BidOutcome, string> = {
  won: "ชนะ",
  leading: "กำลังนำ",
  outbid: "ถูกแซง",
  lost: "ไม่ชนะ",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "รอชำระ",
  successful: "ชำระแล้ว",
  failed: "ล้มเหลว",
  expired: "หมดอายุ",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "บัตรเครดิต/เดบิต",
  promptpay: "พร้อมเพย์",
  installment: "ผ่อนชำระ",
  shopeepay: "ShopeePay",
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "รอโอน",
  transferred: "โอนแล้ว",
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  pending: "รอส่ง",
  sent: "ส่งแล้ว",
  paid: "เข้าบัญชีแล้ว",
  failed: "โอนไม่สำเร็จ",
};

export const AUCTION_STATUS_LABEL: Record<AuctionStatus, string> = {
  draft: "ร่าง",
  active: "กำลังประมูล",
  ended: "จบแล้ว",
  cancelled: "ยกเลิก",
};
