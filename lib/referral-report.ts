import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * What inviting has actually produced, for an admin.
 *
 * Two questions and a warning. How many people came in through somebody's
 * link; how many of those got as far as proving a phone number; and whether
 * any of it looks like one person filling in forms rather than several people
 * arriving.
 *
 * There is still no reward — see lib/referral.ts. That matters here because a
 * leaderboard is exactly the sort of page a reward scheme gets attached to,
 * and until one exists these are counts, not entitlements.
 *
 * READ ONLY, like every other page it feeds. The ring section names accounts
 * for a person to look at; it blocks nothing and flags nothing on the accounts
 * themselves, which is the same posture lib/fraud-signals.ts takes for bids.
 */

export type ReferralTotals = {
  /** Every referral ever recorded. */
  total: number;
  verified: number;
  /** verified as a whole-number percentage of total; 0 when there are none. */
  verifiedPercent: number;
  /** Sign-ups through a link in the last 30 days... */
  last30: number;
  /** ...and in the 30 days before those, to say which way it is going. */
  previous30: number;
};

export type ReferrerRow = {
  id: string;
  name: string;
  email: string;
  /** Everyone they brought in. */
  total: number;
  /** Of those, the ones still at signed_up... */
  signedUp: number;
  /** ...and the ones who verified a phone. */
  verified: number;
  lastAt: Date;
};

export type ReferralRing = {
  referrerId: string;
  referrerName: string;
  /** The origin, already shortened — see maskIp. */
  ip: string;
  accounts: { id: string; name: string }[];
  lastAt: Date;
};

export type ReferralReport = {
  totals: ReferralTotals;
  referrers: ReferrerRow[];
  rings: ReferralRing[];
};

/** A whole-number percentage that is 0 rather than NaN when nothing happened. */
export function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

/**
 * Three or more accounts, one referrer, one address.
 *
 * Two is a couple sharing a flat, or a phone and a laptop on the same wifi.
 * Three starts to be a pattern, and the threshold is deliberately the same
 * kind of judgement lib/fraud-signals.ts makes about bids: it is the number
 * above which a human should look, not the number at which anything is proven.
 */
export const RING_MIN_ACCOUNTS = 3;

/** How many rings and how many referrers a page will show. */
const DEFAULT_LIMIT = 50;

type RingRow = {
  referrerId: string;
  ipAddress: string;
  referredIds: string[];
  lastAt: Date;
};

/**
 * Show enough of an address to group by, and no more.
 *
 * The admin's question is "are these the same origin", which the last octet
 * never helps with, and a full address is a piece of personal data that this
 * page does not need to display in order to answer it. IPv6 is cut after its
 * routing half for the same reason.
 */
export function maskIp(value: string): string {
  if (value.includes(":")) {
    const groups = value.split(":").filter(Boolean);
    return `${groups.slice(0, 3).join(":")}:···`;
  }
  const octets = value.split(".");
  if (octets.length !== 4) return "···";
  return `${octets.slice(0, 3).join(".")}.···`;
}

export async function referralReport(
  limit = DEFAULT_LIMIT,
  now = new Date(),
): Promise<ReferralReport> {
  const since30 = new Date(now.getTime() - DAYS_30);
  const since60 = new Date(now.getTime() - 2 * DAYS_30);

  const [total, verified, last30, previous30, grouped, rings] = await Promise.all([
    prisma.referral.count(),
    prisma.referral.count({ where: { status: "verified" } }),
    prisma.referral.count({ where: { signedUpAt: { gte: since30 } } }),
    prisma.referral.count({
      where: { signedUpAt: { gte: since60, lt: since30 } },
    }),

    // Grouped in the database. The alternative — every referral row into
    // memory to count them per referrer — is a page that works until the
    // feature does.
    prisma.referral.groupBy({
      by: ["referrerId", "status"],
      _count: { _all: true },
      _max: { signedUpAt: true },
    }),

    // Deliberately the same shape as the bid sweep in lib/fraud-signals.ts:
    // group by (who benefits, where it came from), keep the groups above the
    // threshold, and hand a human the names. That file is untouched — its
    // signal is about bidding on one seller's items, this one is about
    // accounts arriving through one person's link, and folding them together
    // would mean one query answering two questions badly.
    prisma.$queryRaw<RingRow[]>`
      SELECT r."referrerId",
             r."ipAddress"                      AS "ipAddress",
             array_agg(DISTINCT r."referredId") AS "referredIds",
             MAX(r."signedUpAt")                AS "lastAt"
        FROM referrals r
       WHERE r."ipAddress" IS NOT NULL
       GROUP BY r."referrerId", r."ipAddress"
      HAVING COUNT(DISTINCT r."referredId") >= ${RING_MIN_ACCOUNTS}
       ORDER BY "lastAt" DESC
       LIMIT ${limit}
    `,
  ]);

  // One lookup for every name the page will print, rather than one per row.
  const userIds = new Set<string>();
  for (const row of grouped) userIds.add(row.referrerId);
  for (const ring of rings) {
    userIds.add(ring.referrerId);
    for (const id of ring.referredIds) userIds.add(id);
  }

  const users =
    userIds.size === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        });
  const byId = new Map(users.map((user) => [user.id, user]));

  const byReferrer = new Map<string, ReferrerRow>();
  for (const row of grouped) {
    const user = byId.get(row.referrerId);
    const existing = byReferrer.get(row.referrerId) ?? {
      id: row.referrerId,
      name: user?.name ?? "(ไม่พบผู้ใช้)",
      email: user?.email ?? "",
      total: 0,
      signedUp: 0,
      verified: 0,
      lastAt: new Date(0),
    };

    const count = row._count._all;
    existing.total += count;
    if (row.status === "verified") existing.verified += count;
    else existing.signedUp += count;

    const at = row._max.signedUpAt;
    if (at && at > existing.lastAt) existing.lastAt = at;

    byReferrer.set(row.referrerId, existing);
  }

  // An account with an invite code but nobody behind it has no row here at all
  // — groupBy only sees referrers that referrals actually point at, which is
  // the same reason the sales report leaves empty categories out of its table.
  const referrers = [...byReferrer.values()]
    .sort((a, b) => b.total - a.total || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, limit);

  return {
    totals: {
      total,
      verified,
      verifiedPercent: percentage(verified, total),
      last30,
      previous30,
    },
    referrers,
    rings: rings.map((ring) => ({
      referrerId: ring.referrerId,
      referrerName: byId.get(ring.referrerId)?.name ?? "(ไม่พบผู้ใช้)",
      ip: maskIp(ring.ipAddress),
      accounts: ring.referredIds.map((id) => ({
        id,
        name: byId.get(id)?.name ?? id,
      })),
      lastAt: ring.lastAt,
    })),
  };
}
