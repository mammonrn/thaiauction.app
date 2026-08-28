import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Possible shill rings, for a human to judge.
 *
 * The signal is: several DIFFERENT accounts bidding on ONE seller's items from
 * the same origin. That is suspicious because it is what a seller running
 * sock-puppets looks like — but it is also what a family sharing a router, a
 * shared office, or a university hall looks like, so nothing here blocks
 * anything. It surfaces a list; a person decides.
 *
 * The strong signals — a verified phone or a KYC identity shared between
 * bidder and seller — are handled elsewhere (lib/anti-shill.ts) and DO refuse
 * the bid, because those prove the same person rather than merely the same
 * network.
 */

export type FraudSignal = {
  signal: "ip" | "device";
  value: string;
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  bidderIds: string[];
  bidderNames: string[];
  bidCount: number;
  lastBidAt: Date;
};

/** Two distinct accounts from one origin is the threshold worth looking at. */
const MIN_ACCOUNTS = 2;

type Row = {
  signal: "ip" | "device";
  value: string;
  sellerId: string;
  bidderIds: string[];
  bidCount: bigint;
  lastBidAt: Date;
};

export async function findFraudSignals(limit = 50): Promise<FraudSignal[]> {
  // Grouped in SQL rather than in JS: the interesting rows are a handful out of
  // potentially every bid ever placed, and dragging the whole bid table into
  // the application to group it would not scale past a toy dataset.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT 'ip' AS signal,
           b."ipAddress" AS value,
           ai."sellerId" AS "sellerId",
           array_agg(DISTINCT b."bidderId") AS "bidderIds",
           COUNT(*) AS "bidCount",
           MAX(b."createdAt") AS "lastBidAt"
    FROM bids b
    JOIN auction_items ai ON ai.id = b."auctionItemId"
    WHERE b."ipAddress" IS NOT NULL
    GROUP BY b."ipAddress", ai."sellerId"
    HAVING COUNT(DISTINCT b."bidderId") >= ${MIN_ACCOUNTS}

    UNION ALL

    SELECT 'device' AS signal,
           b."userAgent" AS value,
           ai."sellerId" AS "sellerId",
           array_agg(DISTINCT b."bidderId") AS "bidderIds",
           COUNT(*) AS "bidCount",
           MAX(b."createdAt") AS "lastBidAt"
    FROM bids b
    JOIN auction_items ai ON ai.id = b."auctionItemId"
    WHERE b."userAgent" IS NOT NULL
    GROUP BY b."userAgent", ai."sellerId"
    HAVING COUNT(DISTINCT b."bidderId") >= ${MIN_ACCOUNTS}

    ORDER BY "lastBidAt" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  // One lookup for every name mentioned, rather than one per group.
  const userIds = new Set<string>();
  for (const row of rows) {
    userIds.add(row.sellerId);
    for (const id of row.bidderIds) userIds.add(id);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  return rows.map((row) => ({
    signal: row.signal,
    value: row.value,
    sellerId: row.sellerId,
    sellerName: byId.get(row.sellerId)?.name ?? "(ไม่พบผู้ใช้)",
    sellerEmail: byId.get(row.sellerId)?.email ?? "",
    bidderIds: row.bidderIds,
    bidderNames: row.bidderIds.map((id) => byId.get(id)?.name ?? id),
    bidCount: Number(row.bidCount),
    lastBidAt: row.lastBidAt,
  }));
}
