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
 *   npm run auctions:settle
 *
 * Suggested crontab (every 5 minutes):
 *   asterisk/5 * * * * cd /srv/thaiauction && /usr/bin/npm run auctions:settle >> /var/log/thaiauction-settle.log 2>&1
 */
import { settleAllExpired } from "../lib/bidding";

async function main() {
  const settled = await settleAllExpired();

  if (settled.length === 0) {
    console.log(`[settle] ${new Date().toISOString()} nothing due`);
    return;
  }

  console.log(
    `[settle] ${new Date().toISOString()} closed ${settled.length}: ${settled.join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[settle] failed:", error);
    process.exit(1);
  });
