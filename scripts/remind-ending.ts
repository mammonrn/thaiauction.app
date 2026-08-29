/**
 * Remind bidders that an auction they are in closes shortly.
 *
 * The one notification nothing else can produce. Every other kind follows from
 * something a person just did — a bid, a purchase, a payment — and is emitted
 * by the request that did it. "This is about to end" follows from time passing,
 * which no request observes.
 *
 * Idempotent by construction: each reminder is written `onceEver` against a key
 * naming the auction, so running this twice in a row, or every five minutes for
 * the whole final quarter of an hour, tells each bidder exactly once. There is
 * no cursor to keep and no state to corrupt by running it twice at the same
 * moment.
 *
 *   npm run notifications:remind-ending
 *
 * Suggested crontab — every 5 minutes, which is what makes the 15-minute
 * window meaningful. Less often and someone bidding on an auction that closes
 * in fourteen minutes could be told with four minutes left:
 *   asterisk/5 * * * * cd /srv/thaiauction && /usr/bin/npm run notifications:remind-ending >> /var/log/thaiauction-notify.log 2>&1
 */
import { remindEndingSoon } from "../lib/notifications";

async function main() {
  const stamp = new Date().toISOString();
  const sent = await remindEndingSoon();
  console.log(
    sent === 0
      ? `[remind-ending] ${stamp} nothing closing soon`
      : `[remind-ending] ${stamp} reminded ${sent}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[remind-ending] failed:", error);
    process.exit(1);
  });
