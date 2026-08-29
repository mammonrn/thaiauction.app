import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * What the marketplace has actually sold.
 *
 * Every figure is READ, never recomputed. `fee`, `feeVat`, `net` and
 * `commission` were written onto the payment row from the Omise charge at the
 * moment it settled — Omise's own numbers, which vary by method and by card —
 * so working the VAT back out of `amount` here would produce a report that
 * quietly disagrees with what was really taken. The rule this file follows is
 * the one lib/payments.ts already follows: the gateway is the authority on what
 * it charged, and we only add up what it told us.
 *
 * "Sold" is `paidAt IS NOT NULL`. That column is written in the same statement
 * that records the money and only when a charge came back successful, so a
 * pending QR, an expired one and a declined card are all excluded by it without
 * a second condition to keep in step.
 */

export type SalesTotals = {
  /** Σ amount — what buyers paid. */
  sales: number;
  /** Σ fee — Omise's charge, before its VAT. */
  omiseFee: number;
  /** Σ feeVat — the VAT on that charge. */
  omiseVat: number;
  /** The two together: everything that went to Omise. */
  omiseTotal: number;
  /**
   * Σ commission — the platform's share.
   *
   * Called commission REVENUE and never "profit": nothing here knows what the
   * servers, the support or the transfer fees cost, and a page headed "กำไร"
   * would be asserting something this data cannot support.
   */
  commission: number;
  /** How many sales those figures come from. */
  count: number;
};

export type CategorySales = {
  id: string;
  name: string;
  slug: string;
  count: number;
  sales: number;
  commission: number;
};

export type SalesReport = {
  totals: SalesTotals;
  categories: CategorySales[];
  /** Categories that exist but have never sold anything in this window. */
  quietCategories: number;
  from: Date | null;
  to: Date | null;
};

/**
 * Bangkok is UTC+7 all year — no daylight saving, ever — so a calendar day is
 * a fixed seven-hour shift rather than something that needs a timezone library.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Widest possible bounds, so the query never needs a conditional WHERE. */
const DAWN = new Date(0);
const DUSK = new Date("9999-12-31T00:00:00.000Z");

/**
 * Turn a `yyyy-mm-dd` from a date input into the instant the Bangkok day began.
 *
 * A report filtered "29 สิงหาคม" must mean the day an admin in Bangkok lived
 * through, not the UTC one — which starts at 7am their time and would put a
 * morning's sales in the wrong bucket.
 */
export function bangkokDayStart(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const utcMidnight = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight)) return null;
  return new Date(utcMidnight - BANGKOK_OFFSET_MS);
}

/** The last instant of that Bangkok day, so `to` includes the day it names. */
export function bangkokDayEnd(value: string | undefined): Date | null {
  const start = bangkokDayStart(value);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  count: bigint;
  sales: bigint | null;
  commission: bigint | null;
};

/**
 * The whole report, for a window or for all time.
 *
 * Grouped in the database rather than in JavaScript. The alternative — every
 * paid row into memory and a reduce over it — is a page that works until the
 * marketplace succeeds, and this one is only ever going to be asked for wider
 * windows as time goes on.
 *
 * A category with nothing sold is left OUT of the table and counted on its own
 * line instead. The table answers "what sells", and twenty-odd rows of zeros on
 * a phone bury the handful that do; the count on its own line keeps the fact
 * that they exist without spending a screen on it.
 */
export async function salesReport(params: {
  from?: Date | null;
  to?: Date | null;
}): Promise<SalesReport> {
  const from = params.from ?? null;
  const to = params.to ?? null;
  const gte = from ?? DAWN;
  const lte = to ?? DUSK;

  const where = { paidAt: { not: null, gte, lte } };

  const [aggregate, rows, categoryCount] = await Promise.all([
    prisma.payment.aggregate({
      where,
      _sum: { amount: true, fee: true, feeVat: true, commission: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<CategoryRow[]>`
      SELECT c."id",
             c."name",
             c."slug",
             COUNT(*)                        AS "count",
             COALESCE(SUM(p."amount"), 0)    AS "sales",
             COALESCE(SUM(p."commission"), 0) AS "commission"
        FROM "payments" p
        JOIN "auction_items" i ON i."id" = p."auctionItemId"
        JOIN "categories" c    ON c."id" = i."categoryId"
       WHERE p."paidAt" IS NOT NULL
         AND p."paidAt" >= ${gte}
         AND p."paidAt" <= ${lte}
       GROUP BY c."id", c."name", c."slug"
       ORDER BY "sales" DESC, c."name" ASC
    `,
    prisma.category.count(),
  ]);

  const omiseFee = aggregate._sum.fee ?? 0;
  const omiseVat = aggregate._sum.feeVat ?? 0;

  const categories: CategorySales[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    count: Number(row.count),
    // SUM over an integer column comes back as bigint in Postgres, which JSON
    // cannot carry and React cannot render. Satang fit in a double with room
    // to spare, so the narrowing is safe rather than merely convenient.
    sales: Number(row.sales ?? 0),
    commission: Number(row.commission ?? 0),
  }));

  return {
    totals: {
      sales: aggregate._sum.amount ?? 0,
      omiseFee,
      omiseVat,
      omiseTotal: omiseFee + omiseVat,
      commission: aggregate._sum.commission ?? 0,
      count: aggregate._count._all,
    },
    categories,
    quietCategories: Math.max(0, categoryCount - categories.length),
    from,
    to,
  };
}
