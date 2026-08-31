/**
 * Close auctions whose end time has passed.
 *
 * Settlement is primarily lazy: viewing an auction, or polling its live state,
 * settles it. That covers anything anyone is looking at, which for a
 * marketplace is most of what matters. This sweep exists for the rest — an
 * auction that ends at 3am with nobody watching should still be closed and its
 * winner recorded, rather than waiting for the next visitor.
 *
 * Written as a script rather than an HTTP endpoint on purpose: a cron entry can
 * run it with the same DATABASE_URL the app already uses, so there is no public
 * route to protect and no shared secret to manage.
 *
 * Four passes, in this order, because each depends on the one before:
 *   1. close auctions whose time is up;
 *   2. reconcile payments against Omise;
 *   3. forfeit winners who did not pay, and offer the item to the next bidder;
 *   4. close second-chance offers nobody answered inside their 24 hours.
 *
 * Reconciling before judging deadlines is the important part: a payment that
 * landed while nobody was watching must be seen BEFORE the deadline sweep, or
 * a buyer who paid on time would be struck for not paying.
 *
 *   npm run auctions:settle
 *
 * Suggested crontab (every 5 minutes):
 *   asterisk/5 * * * * cd /srv/thaiauction && /usr/bin/npm run auctions:settle >> /var/log/thaiauction-settle.log 2>&1
 */
import { settleAllExpired, sweepPaymentDeadlines } from "../lib/bidding";
import { expireSecondChances } from "../lib/failed-deal";
import {
  notifySecondChanceClosed,
  syncAuctionNotifications,
  syncFailedDealNotifications,
  syncMissedPaymentNotifications,
} from "../lib/notifications";
import { reconcilePayments } from "../lib/payments";

async function main() {
  const stamp = new Date().toISOString();

  // 1. Close auctions whose clock has run out.
  const settled = await settleAllExpired();
  console.log(
    settled.length === 0
      ? `[settle] ${stamp} nothing due`
      : `[settle] ${stamp} closed ${settled.length}: ${settled.join(", ")}`,
  );

  // 2. Bring payments up to date with Omise BEFORE judging deadlines, so a
  //    buyer who paid at the last minute is never struck for it. This project
  //    has no webhook endpoint by design, so a scanned QR whose buyer closed
  //    the tab only becomes visible here.
  try {
    const { refreshed, adopted, abandoned } = await reconcilePayments();
    console.log(
      `[reconcile] ${stamp} refreshed ${refreshed.length}, adopted ${adopted.length}, abandoned ${abandoned.length}`,
    );
  } catch (error) {
    // A gateway outage must not stop settlement running. The next pass retries.
    console.error(`[reconcile] ${stamp} failed:`, error);
  }

  // 3. Move on anyone who let their 24 hours lapse, recording a strike and
  //    offering the item to the next bidder.
  const forfeited = await sweepPaymentDeadlines();
  console.log(
    forfeited.length === 0
      ? `[payment-deadline] ${stamp} nothing overdue`
      : `[payment-deadline] ${stamp} forfeited ${forfeited.length}: ${forfeited.join(", ")}`,
  );

  // 4. Close second-chance offers whose 24 hours ran out. Nobody is struck for
  //    one of these: an offer nobody answered is an offer nobody took on. The
  //    item goes back to waiting on its seller, who is told below.
  const lapsed = await expireSecondChances();
  console.log(
    lapsed.length === 0
      ? `[second-chance] ${stamp} nothing lapsed`
      : `[second-chance] ${stamp} closed ${lapsed.length}: ${lapsed.map((o) => o.itemId).join(", ")}`,
  );
  for (const offer of lapsed) {
    // Wrapped, like every other notification in this file's world: a sweep that
    // has already moved the state must not fail because a bell did not ring.
    try {
      await notifySecondChanceClosed({
        offerId: offer.offerId,
        itemTitle: offer.itemTitle,
        sellerId: offer.sellerId,
        outcome: "expired",
      });
    } catch (error) {
      console.error(`[second-chance] ${stamp} notify failed:`, error);
    }
  }

  // 5. Say what happened. Last, so it reports the state the passes above have
  //    just settled on, and reconciled rather than hooked: the transitions live
  //    inside lib/bidding and lib/payments, which this feature does not modify.
  //    Every call swallows its own failures — a notification problem must never
  //    stop the sweep that moves money.
  await syncAuctionNotifications();
  await syncMissedPaymentNotifications();
  await syncFailedDealNotifications();
  console.log(`[notify] ${stamp} caught up`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[settle] failed:", error);
    process.exit(1);
  });
