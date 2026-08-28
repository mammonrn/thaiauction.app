/**
 * Erase bid origin metadata once it is past its retention period.
 *
 * IP addresses and User-Agent strings are collected for one purpose — spotting
 * several accounts bidding from one machine on one seller's items — and PDPA's
 * data-minimisation principle says they should not outlive it. This clears the
 * two columns after the window declared at /privacy.
 *
 * The BID IS NOT DELETED. A bid is a financial record and is kept forever; only
 * the network metadata attached to it expires. That distinction is the whole
 * point of the script, so it uses updateMany, never deleteMany.
 *
 *   npm run bids:prune
 *
 * Suggested crontab (daily, off-peak):
 *   17 4 * * * cd /srv/thaiauction && /usr/bin/npm run bids:prune >> /var/log/thaiauction-prune.log 2>&1
 */
import { prisma } from "../lib/prisma";
import { BID_METADATA_RETENTION_DAYS } from "../lib/retention";

async function main() {
  const cutoff = new Date(
    Date.now() - BID_METADATA_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { count } = await prisma.bid.updateMany({
    where: {
      createdAt: { lt: cutoff },
      // Only rows that still hold something, so a re-run is a cheap no-op
      // rather than a rewrite of every historical bid.
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
    },
    data: { ipAddress: null, userAgent: null },
  });

  console.log(
    `[prune] ${new Date().toISOString()} cleared origin metadata from ${count} bid(s) older than ${BID_METADATA_RETENTION_DAYS} days`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[prune] failed:", error);
    process.exit(1);
  });
