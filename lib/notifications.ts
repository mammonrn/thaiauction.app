import "server-only";

import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

/**
 * In-app notifications, and the push that announces them.
 *
 * Two rules hold everywhere in this file.
 *
 * 1. The ROW is the source of truth. Web Push is a loudspeaker held up to it —
 *    written first, pushed afterwards, and a push that never arrives changes
 *    nothing about what the bell shows.
 *
 * 2. Nothing here may break the thing that triggered it. Every entry point is
 *    called AFTER the bidding or payment code has already returned success,
 *    from the layer above it, and `notify` swallows its own failures. A bid
 *    that succeeded must not be reported as failed because a notification
 *    could not be written. lib/bidding.ts and lib/payments.ts are not modified
 *    and do not import this.
 *
 * The text is frozen at creation rather than rendered on read: a notification
 * records what was true when it happened, so "เสนอราคา ฿1,200" stays correct
 * after the price moves, and it survives the listing being taken down.
 */

export type NotificationType =
  | "new_bid"
  | "buy_now"
  | "payment_received"
  | "payment_missed"
  | "outbid"
  | "ending_soon"
  | "auction_won"
  | "bank_verified"
  | "bank_rejected"
  | "payout_sent";

/** Older than this and the list page stops showing it. */
export const NOTIFICATION_MAX_AGE_DAYS = 90;

type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  /**
   * What this is ABOUT, for collapsing repeats. Usually
   * "<type>:<auctionItemId>". Required by both dedupe modes below; without it
   * every call writes a new row.
   */
  dedupeKey?: string;
  /**
   * Collapse into an existing UNREAD notification with the same key, updating
   * its text and timestamp. Twenty rapid bids should be one line in the bell
   * that keeps changing, not twenty.
   */
  collapseUnread?: boolean;
  /**
   * Skip entirely if one with this key already exists, read or not. For things
   * only ever worth saying once — "this auction is ending", which a sweep
   * running every few minutes would otherwise repeat.
   */
  onceEver?: boolean;
};

/**
 * Write one notification, then try to push it.
 *
 * Returns the row id, or null when nothing was written (deduped away, or the
 * write failed). Callers do not check: this is deliberately fire-and-forget,
 * and the caller's own work has already succeeded by the time it runs.
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  try {
    if (input.onceEver && input.dedupeKey) {
      const existing = await prisma.notification.findFirst({
        where: { userId: input.userId, dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (existing) return null;
    }

    if (input.collapseUnread && input.dedupeKey) {
      const unread = await prisma.notification.findFirst({
        where: {
          userId: input.userId,
          dedupeKey: input.dedupeKey,
          readAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (unread) {
        // Refresh the text AND the timestamp: the newest price is the useful
        // one, and it should sort to the top of the list as if it were new.
        const updated = await prisma.notification.update({
          where: { id: unread.id },
          data: {
            title: input.title,
            body: input.body,
            createdAt: new Date(),
          },
          select: { id: true },
        });
        void pushQuietly(input);
        return updated.id;
      }
    }

    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        url: input.url,
        dedupeKey: input.dedupeKey ?? null,
      },
      select: { id: true },
    });

    void pushQuietly(input);
    return created.id;
  } catch (error) {
    // The whole point of this catch: a bid, a purchase or a payment has
    // already succeeded. Losing its notification is a smaller failure than
    // telling the user their bid did not land.
    console.error("[notify] failed:", error);
    return null;
  }
}

/**
 * Fire-and-forget push.
 *
 * Not awaited by `notify`, so the buyer's response is never held up by a push
 * service, and its rejection can never reach the caller's try/catch.
 */
function pushQuietly(input: NotifyInput): void {
  void sendPushToUser(input.userId, {
    title: input.title,
    body: input.body,
    url: input.url,
  }).catch((error) => {
    console.error("[notify] push failed:", error);
  });
}

/* ------------------------------------------------------------------ events */

/**
 * A bid landed on someone's listing.
 *
 * Two notifications from one event, both skipping the person who caused it:
 * the seller hears that their item moved, and whoever just lost the lead hears
 * that they were passed. `previousLeaderId` is read by the CALLER before the
 * bid, because afterwards the previous leader is no longer distinguishable
 * from any other underbidder.
 */
export async function notifyBidPlaced(params: {
  itemId: string;
  itemTitle: string;
  sellerId: string;
  bidderId: string;
  amount: number;
  previousLeaderId: string | null;
}): Promise<void> {
  const url = `/auctions/${params.itemId}`;

  if (params.sellerId !== params.bidderId) {
    await notify({
      userId: params.sellerId,
      type: "new_bid",
      title: "มีคนเสนอราคา",
      body: `${params.itemTitle} — ${formatBaht(params.amount)}`,
      url,
      dedupeKey: `new_bid:${params.itemId}`,
      collapseUnread: true,
    });
  }

  // Only the person who just lost the lead. Everyone below them was already
  // outbid and has been told once; telling them again on every subsequent bid
  // is how a bell becomes something people switch off.
  if (
    params.previousLeaderId &&
    params.previousLeaderId !== params.bidderId &&
    params.previousLeaderId !== params.sellerId
  ) {
    await notify({
      userId: params.previousLeaderId,
      type: "outbid",
      title: "มีคนเสนอราคาสูงกว่าคุณ",
      body: `${params.itemTitle} — ตอนนี้ ${formatBaht(params.amount)}`,
      url,
      dedupeKey: `outbid:${params.itemId}`,
      collapseUnread: true,
    });
  }
}

/** Someone bought a listing outright. */
export async function notifyBuyNow(params: {
  itemId: string;
  itemTitle: string;
  sellerId: string;
  buyerId: string;
  amount: number;
  previousLeaderId: string | null;
}): Promise<void> {
  if (params.sellerId !== params.buyerId) {
    await notify({
      userId: params.sellerId,
      type: "buy_now",
      title: "ขายได้แล้ว",
      body: `${params.itemTitle} — ซื้อทันทีที่ ${formatBaht(params.amount)}`,
      url: `/auctions/${params.itemId}`,
      dedupeKey: `buy_now:${params.itemId}`,
      onceEver: true,
    });
  }

  // The buyer goes straight to the pay page, so their "you won" points there.
  await notifyAuctionWon({
    itemId: params.itemId,
    itemTitle: params.itemTitle,
    winnerId: params.buyerId,
    amount: params.amount,
  });

  // Whoever was leading has now lost the item outright, not merely been
  // outbid. They are told, unless they are the one who bought it.
  if (
    params.previousLeaderId &&
    params.previousLeaderId !== params.buyerId &&
    params.previousLeaderId !== params.sellerId
  ) {
    await notify({
      userId: params.previousLeaderId,
      type: "outbid",
      title: "รายการนี้ถูกซื้อทันทีไปแล้ว",
      body: `${params.itemTitle} — ปิดที่ ${formatBaht(params.amount)}`,
      url: `/auctions/${params.itemId}`,
      dedupeKey: `outbid:${params.itemId}`,
      collapseUnread: true,
    });
  }
}

/**
 * Someone won.
 *
 * Points at the pay page, not the listing: the winner's next action is to pay,
 * and their 24 hours are already running.
 */
export async function notifyAuctionWon(params: {
  itemId: string;
  itemTitle: string;
  winnerId: string;
  amount: number;
}): Promise<void> {
  await notify({
    userId: params.winnerId,
    type: "auction_won",
    title: "คุณชนะการประมูล",
    body: `${params.itemTitle} — ${formatBaht(params.amount)} · ชำระภายใน 24 ชั่วโมง`,
    url: `/auctions/${params.itemId}/pay`,
    dedupeKey: `auction_won:${params.itemId}`,
    onceEver: true,
  });
}

/** The winner's money arrived. Only the seller needs telling. */
export async function notifyPaymentReceived(params: {
  itemId: string;
  itemTitle: string;
  sellerId: string;
  amount: number;
}): Promise<void> {
  await notify({
    userId: params.sellerId,
    type: "payment_received",
    title: "ได้รับเงินแล้ว",
    body: `${params.itemTitle} — ${formatBaht(params.amount)} · จัดส่งได้เลย`,
    url: "/sell",
    // Payment success is detected in two places — the buyer's poll and the
    // settle sweep — and whichever sees it first should be the only one that
    // tells the seller.
    dedupeKey: `payment_received:${params.itemId}`,
    onceEver: true,
  });
}

/** A winner let their deadline lapse. */
export async function notifyPaymentMissed(params: {
  itemId: string;
  itemTitle: string;
  sellerId: string;
}): Promise<void> {
  await notify({
    userId: params.sellerId,
    type: "payment_missed",
    title: "ผู้ชนะไม่ชำระเงินตามกำหนด",
    body: `${params.itemTitle} — ระบบเสนอให้ผู้เสนอราคารายถัดไปแล้ว`,
    url: `/auctions/${params.itemId}`,
    dedupeKey: `payment_missed:${params.itemId}`,
    onceEver: true,
  });
}

/**
 * An auction someone is bidding on is about to close.
 *
 * `onceEver`, not `collapseUnread`: an auction ends once, and the reminder sweep
 * runs every few minutes. Without this a bidder would be told every five
 * minutes for the last quarter of an hour, and reading the earlier one would
 * make the next a fresh unread.
 */
export async function notifyEndingSoon(params: {
  itemId: string;
  itemTitle: string;
  bidderId: string;
  minutesLeft: number;
}): Promise<string | null> {
  return notify({
    userId: params.bidderId,
    type: "ending_soon",
    title: "ประมูลใกล้จบแล้ว",
    body: `${params.itemTitle} — เหลืออีกประมาณ ${params.minutesLeft} นาที`,
    url: `/auctions/${params.itemId}`,
    dedupeKey: `ending_soon:${params.itemId}`,
    onceEver: true,
  });
}

/**
 * Omise accepted the seller's bank account.
 *
 * `onceEver` on the recipient id rather than on the user: a seller who changes
 * banks gets a new recipient and deserves to be told that one passed too, but
 * the sweep that polls Omise must not re-announce the same one every run.
 */
export async function notifyBankVerified(params: {
  sellerId: string;
  recipientId: string;
}): Promise<void> {
  await notify({
    userId: params.sellerId,
    type: "bank_verified",
    title: "บัญชีธนาคารพร้อมรับเงินแล้ว",
    body: "ยอดขายจะโอนเข้าบัญชีนี้อัตโนมัติหลังทีมงานอนุมัติ",
    url: "/account/bank",
    dedupeKey: `bank_verified:${params.recipientId}`,
    onceEver: true,
  });
}

/**
 * Omise rejected it, or a payout cannot go out until the seller acts.
 *
 * The only notification in this file that asks for something back, which is why
 * it names the page to fix it on rather than merely reporting a state.
 */
export async function notifyBankRejected(params: {
  sellerId: string;
  recipientId: string;
  reason: string;
}): Promise<void> {
  await notify({
    userId: params.sellerId,
    type: "bank_rejected",
    title: "ตรวจสอบบัญชีธนาคารไม่ผ่าน",
    body: `${params.reason} — กรุณาแก้ไขบัญชีธนาคารเพื่อรับเงิน`,
    url: "/account/bank",
    dedupeKey: `bank_rejected:${params.recipientId}`,
    onceEver: true,
  });
}

/**
 * The money has left for the seller's bank account.
 *
 * Keyed on the payment, not the auction: one sale is paid out once, and the
 * transfer sweep re-reads a transfer on every run until the bank confirms it.
 */
export async function notifyPayoutSent(params: {
  paymentId: string;
  itemTitle: string;
  sellerId: string;
  amount: number;
}): Promise<void> {
  await notify({
    userId: params.sellerId,
    type: "payout_sent",
    title: "โอนเงินให้แล้ว",
    body: `${params.itemTitle} — ${formatBaht(params.amount)} เข้าบัญชีธนาคารของคุณ`,
    url: "/sell",
    dedupeKey: `payout_sent:${params.paymentId}`,
    onceEver: true,
  });
}

/* ------------------------------------------------------------------ reading */

/** How many unread notifications this person has. Drives the bell's badge. */
export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null, createdAt: { gte: cutoff() } },
  });
}

function cutoff(): Date {
  return new Date(Date.now() - NOTIFICATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export const NOTIFICATIONS_PER_PAGE = 20;

/**
 * One page of somebody's notifications, newest first.
 *
 * `userId` is in the WHERE clause rather than compared afterwards, so another
 * person's rows cannot be reached by any id. One extra row is fetched to learn
 * whether there is a next page without a second COUNT.
 */
export async function listNotifications(
  userId: string,
  page = 1,
): Promise<{
  items: {
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    url: string;
    readAt: Date | null;
    createdAt: Date;
  }[];
  hasMore: boolean;
  page: number;
}> {
  const current = Math.max(1, Math.floor(page));
  const rows = await prisma.notification.findMany({
    where: { userId, createdAt: { gte: cutoff() } },
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * NOTIFICATIONS_PER_PAGE,
    take: NOTIFICATIONS_PER_PAGE + 1,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      readAt: true,
      createdAt: true,
    },
  });

  return {
    items: rows.slice(0, NOTIFICATIONS_PER_PAGE),
    hasMore: rows.length > NOTIFICATIONS_PER_PAGE,
    page: current,
  };
}

/**
 * Mark one notification read.
 *
 * Ownership is part of the WHERE, so somebody else's id simply matches
 * nothing — "not yours" and "does not exist" are the same answer, as
 * everywhere else in this codebase that takes a guessable id.
 */
export async function markRead(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count > 0;
}

/** Mark everything unread as read. */
export async function markAllRead(userId: string): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

/* ------------------------------------------------------- catching up */

/**
 * Emit the notifications that follow from an auction's CURRENT state.
 *
 * Written as a reconciliation rather than as a hook on each transition,
 * because the transitions happen inside lib/bidding.ts and lib/payments.ts —
 * which this feature may not touch — and are reached from several places:
 * a payment settles either when the buyer's tab polls it or when the sweep
 * reconciles with Omise; an auction closes on a page view, on a late bid, on
 * the seller ending it, or on the sweep. Hooking every one of those would mean
 * the same notification sent twice from two paths, or missed entirely on a
 * third.
 *
 * Instead this asks what is true now and fills in what has not been said. Each
 * emit is `onceEver` on a key naming the item, so running it after every poll
 * AND every sweep produces exactly one of each notification.
 *
 * Pass `itemId` to check a single auction — what the state route does, so the
 * seller hears about a payment the moment the buyer's own tab sees it.
 */
export async function syncAuctionNotifications(itemId?: string): Promise<void> {
  try {
    const items = await prisma.auctionItem.findMany({
      where: {
        ...(itemId ? { id: itemId } : {}),
        status: { in: ["ended", "cancelled"] },
        // Only auctions that reached an outcome worth announcing. `unpaid`
        // means every bidder in turn lapsed, and its strikes were already
        // announced one at a time as each deadline passed.
        paymentState: { in: ["awaiting_payment", "paid"] },
        winnerId: { not: null },
        // A sweep looking back further than this would announce history on
        // its first run after deploy. One item asked for by id is exempt.
        ...(itemId ? {} : { endedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      },
      select: {
        id: true,
        title: true,
        sellerId: true,
        winnerId: true,
        currentPrice: true,
        paymentState: true,
      },
      take: 200,
    });

    for (const item of items) {
      if (!item.winnerId) continue;

      // The winner is told once, however the auction happened to close.
      await notifyAuctionWon({
        itemId: item.id,
        itemTitle: item.title,
        winnerId: item.winnerId,
        amount: item.currentPrice,
      });

      if (item.paymentState === "paid") {
        await notifyPaymentReceived({
          itemId: item.id,
          itemTitle: item.title,
          sellerId: item.sellerId,
          amount: item.currentPrice,
        });
      }
    }
  } catch (error) {
    console.error("[notify] auction sync failed:", error);
  }
}

/**
 * Tell sellers about winners who let their deadline lapse.
 *
 * Driven by the strike rows rather than by the forfeit call, for the same
 * reason as above: `forfeitAndReoffer` lives in lib/bidding.ts, and a strike
 * is the durable record that it happened. `onceEver` on the item keeps a
 * re-run silent.
 */
export async function syncMissedPaymentNotifications(): Promise<void> {
  try {
    const strikes = await prisma.paymentStrike.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: {
        auctionItem: { select: { id: true, title: true, sellerId: true } },
      },
      take: 200,
    });

    for (const strike of strikes) {
      await notifyPaymentMissed({
        itemId: strike.auctionItem.id,
        itemTitle: strike.auctionItem.title,
        sellerId: strike.auctionItem.sellerId,
      });
    }
  } catch (error) {
    console.error("[notify] missed-payment sync failed:", error);
  }
}

/**
 * Remind everyone bidding on an auction that closes within the window.
 *
 * Every distinct bidder, the seller excluded — they can see their own
 * listing's clock. `onceEver` means the sweep can run every few minutes for
 * the whole final quarter of an hour and each bidder is told once.
 */
export const ENDING_SOON_WINDOW_MS = 15 * 60 * 1000;

export async function remindEndingSoon(): Promise<number> {
  const now = Date.now();
  const items = await prisma.auctionItem.findMany({
    where: {
      status: "active",
      deletedAt: null,
      endTime: { not: null, gt: new Date(now), lte: new Date(now + ENDING_SOON_WINDOW_MS) },
    },
    select: {
      id: true,
      title: true,
      sellerId: true,
      endTime: true,
      bids: { select: { bidderId: true }, distinct: ["bidderId"] },
    },
  });

  let sent = 0;
  for (const item of items) {
    const minutesLeft = Math.max(
      1,
      Math.round(((item.endTime?.getTime() ?? now) - now) / 60_000),
    );

    for (const bid of item.bids) {
      if (bid.bidderId === item.sellerId) continue;
      const id = await notifyEndingSoon({
        itemId: item.id,
        itemTitle: item.title,
        bidderId: bid.bidderId,
        minutesLeft,
      });
      if (id) sent += 1;
    }
  }
  return sent;
}
