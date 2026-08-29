/**
 * The sales report: does it add up, and does it add up the right rows.
 *
 * The whole risk in a report like this is silent: a figure that is plausible
 * but wrong, from a row that should not have been counted or a number that was
 * recomputed instead of read. So every total is checked against the fixtures'
 * own arithmetic rather than against a constant, and the rows that must NOT be
 * counted are created deliberately and then proven absent.
 *
 * The admin gate is not asserted here — requireAdmin reaches for the request's
 * headers, so it can only be exercised through a real request. It is proven in
 * the browser: a signed-in non-admin asking for /admin/reports/sales gets 404.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/sales-report.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import {
  bangkokDayEnd,
  bangkokDayStart,
  salesReport,
} from "../lib/sales-report";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         ${detail}`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

/* ----------------------------------------------------------------- fixtures */

async function resetFixtures() {
  const fixtures = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });
  if (fixtures.length === 0) return;
  const ids = fixtures.map((u) => u.id);
  const items = await prisma.auctionItem.findMany({
    where: { OR: [{ sellerId: { in: ids } }, { winnerId: { in: ids } }] },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.itemReport.deleteMany({
    where: {
      OR: [
        { auctionItemId: { in: itemIds } },
        { reporterId: { in: ids } },
        { reviewedById: { in: ids } },
      ],
    },
  });
  await prisma.userBan.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
  });
  await prisma.sellerVerification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { reviewedById: { in: ids } }] },
  });
  await prisma.verifiedPhone.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auctionItem.updateMany({
    where: { deletedById: { in: ids } },
    data: { deletedById: null },
  });
  await prisma.payment.updateMany({
    where: { payoutById: { in: ids } },
    data: { payoutById: null },
  });
  await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.paymentStrike.deleteMany({ where: { userId: { in: ids } } });
  await prisma.bid.deleteMany({
    where: { OR: [{ auctionItemId: { in: itemIds } }, { bidderId: { in: ids } }] },
  });
  await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.bankAccountChange.deleteMany({ where: { userId: { in: ids } } });
  await prisma.sellerBankAccount.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function person(tag: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
      name: `ผู้ใช้ ${tag}`,
    },
  });
}

async function category(name: string, slug: string) {
  return prisma.category.upsert({
    where: { slug },
    update: {},
    create: { name, slug },
  });
}

type SaleSpec = {
  categoryId: string;
  amount: number;
  fee: number;
  feeVat: number;
  commission: number;
  /** Null means the charge never settled: pending, failed or expired. */
  paidAt: Date | null;
  status?: "pending" | "successful" | "failed" | "expired";
};

async function sale(sellerId: string, buyerId: string, spec: SaleSpec) {
  const item = await prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: spec.categoryId,
      title: `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: spec.amount,
      currentPrice: spec.amount,
      bidIncrement: 1_000,
      status: "ended",
      winnerId: buyerId,
    },
  });

  const settled = spec.paidAt !== null;

  return prisma.payment.create({
    data: {
      auctionItemId: item.id,
      payerId: buyerId,
      method: "promptpay",
      status: spec.status ?? (settled ? "successful" : "pending"),
      omiseChargeId: `chrg_test_report_${randomUUID().slice(0, 12)}`,
      amount: spec.amount,
      // Unsettled charges carry no money figures at all, exactly as
      // lib/payments.ts leaves them.
      fee: settled ? spec.fee : null,
      feeVat: settled ? spec.feeVat : null,
      net: settled ? spec.amount - spec.fee - spec.feeVat : null,
      commission: settled ? spec.commission : null,
      sellerNet: settled ? spec.amount - spec.fee - spec.feeVat - spec.commission : null,
      paidAt: spec.paidAt,
    },
  });
}

/* -------------------------------------------------------------------- tests */

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  await resetFixtures();

  const seller = await person("ผู้ขาย");
  const buyer = await person("ผู้ซื้อ");

  const amulets = await category("พระเครื่อง", "amulets");
  const cards = await category("การ์ดสะสม", "trading-cards");
  const watches = await category("นาฬิกา", "watches");

  // Three settled sales in two categories, with figures that are deliberately
  // not round so a recomputed VAT could not accidentally match.
  const jan = new Date("2026-01-15T05:00:00.000Z");
  const feb = new Date("2026-02-20T05:00:00.000Z");
  const mar = new Date("2026-03-10T05:00:00.000Z");

  await sale(seller.id, buyer.id, {
    categoryId: amulets.id,
    amount: 1_000_000,
    fee: 36_449,
    feeVat: 2_551,
    commission: 96_100,
    paidAt: jan,
  });
  await sale(seller.id, buyer.id, {
    categoryId: amulets.id,
    amount: 500_000,
    fee: 18_224,
    feeVat: 1_276,
    commission: 48_050,
    paidAt: feb,
  });
  // DELIBERATELY off-formula. The first two sales carry textbook figures — VAT
  // is exactly 7% of the fee, commission exactly 10% of net — which means a
  // report that recomputed instead of reading would agree with them and the
  // test would prove nothing. This one does not add up that way, which is the
  // whole reason the columns are stored: Omise rounds per charge, and what it
  // actually took is a fact rather than a formula.
  await sale(seller.id, buyer.id, {
    categoryId: cards.id,
    amount: 250_000,
    fee: 9_112,
    feeVat: 700,
    commission: 20_000,
    paidAt: mar,
  });

  // Never counted: a QR nobody scanned, a declined card, an expired window.
  await sale(seller.id, buyer.id, {
    categoryId: amulets.id,
    amount: 9_999_900,
    fee: 0,
    feeVat: 0,
    commission: 0,
    paidAt: null,
    status: "pending",
  });
  await sale(seller.id, buyer.id, {
    categoryId: watches.id,
    amount: 8_888_800,
    fee: 0,
    feeVat: 0,
    commission: 0,
    paidAt: null,
    status: "failed",
  });
  await sale(seller.id, buyer.id, {
    categoryId: watches.id,
    amount: 7_777_700,
    fee: 0,
    feeVat: 0,
    commission: 0,
    paidAt: null,
    status: "expired",
  });

  console.log("\nALL-TIME TOTALS");
  {
    const report = await salesReport({});
    const t = report.totals;

    eq("every settled sale is counted", t.count, 3);
    eq("sales are the sum of amount", t.sales, 1_000_000 + 500_000 + 250_000);
    eq("the Omise fee is the sum of fee", t.omiseFee, 36_449 + 18_224 + 9_112);
    eq("the VAT is the sum of feeVat", t.omiseVat, 2_551 + 1_276 + 700);
    eq("and the two add up to what Omise took", t.omiseTotal, t.omiseFee + t.omiseVat);
    eq("commission is the sum of commission", t.commission, 96_100 + 48_050 + 20_000);

    // The figures are READ, not derived. If the report worked VAT back out of
    // amount at 7% it would get these numbers instead — and they are wrong.
    const derivedVat = Math.round((t.omiseFee * 7) / 100);
    check(
      "the VAT is the stored one, not 7% recomputed from the fee",
      t.omiseVat !== derivedVat,
      `stored ${t.omiseVat}, a recomputation would give ${derivedVat}`,
    );

    const derivedCommission = Math.floor((t.sales - t.omiseTotal) / 10);
    check(
      "and the commission is the stored one, not 10% recomputed from net",
      t.commission === 164_150 && t.commission !== derivedCommission,
      `stored ${t.commission}, a recomputation would give ${derivedCommission}`,
    );
  }

  console.log("\nWHAT IS NOT COUNTED");
  {
    const report = await salesReport({});
    const unpaidTotal = 9_999_900 + 8_888_800 + 7_777_700;
    check(
      "a pending, a failed and an expired charge add nothing",
      report.totals.sales < unpaidTotal,
      `sales ${report.totals.sales} should not include ${unpaidTotal}`,
    );
    eq("  the count stays at the settled three", report.totals.count, 3);

    const watchRow = report.categories.find((row) => row.slug === "watches");
    check(
      "a category whose only charges failed does not appear",
      watchRow === undefined,
      JSON.stringify(watchRow),
    );
  }

  console.log("\nBY CATEGORY");
  {
    const report = await salesReport({});

    eq("only categories with a sale are listed", report.categories.length, 2);
    eq("  the biggest first", report.categories[0]?.slug, "amulets");
    eq("  then the next", report.categories[1]?.slug, "trading-cards");

    const [top, second] = report.categories;
    eq("the leading category's sales", top?.sales, 1_500_000);
    eq("  its count", top?.count, 2);
    eq("  and its commission", top?.commission, 96_100 + 48_050);
    eq("  the off-formula category keeps its stored commission", second?.commission, 20_000);
    eq("the second category's sales", second?.sales, 250_000);
    eq("  its count", second?.count, 1);

    const summed = report.categories.reduce((total, row) => total + row.sales, 0);
    eq("the categories add back to the grand total", summed, report.totals.sales);

    const summedCommission = report.categories.reduce(
      (total, row) => total + row.commission,
      0,
    );
    eq("and so does the commission", summedCommission, report.totals.commission);

    const allCategories = await prisma.category.count();
    eq(
      "the categories with nothing sold are counted, not listed",
      report.quietCategories,
      allCategories - 2,
    );
    check("  and there is at least one of them", report.quietCategories > 0);
  }

  console.log("\nDATE RANGE");
  {
    const febOnly = await salesReport({
      from: bangkokDayStart("2026-02-01"),
      to: bangkokDayEnd("2026-02-28"),
    });
    eq("a month window keeps only that month", febOnly.totals.count, 1);
    eq("  with that month's figures", febOnly.totals.sales, 500_000);
    eq("  and that month's commission", febOnly.totals.commission, 48_050);
    eq("  in one category", febOnly.categories.length, 1);

    const janToFeb = await salesReport({
      from: bangkokDayStart("2026-01-01"),
      to: bangkokDayEnd("2026-02-28"),
    });
    eq("a two-month window keeps two", janToFeb.totals.count, 2);
    eq("  and their total", janToFeb.totals.sales, 1_500_000);

    const openEnded = await salesReport({ from: bangkokDayStart("2026-02-01") });
    eq("a start with no end runs to today", openEnded.totals.count, 2);

    const upTo = await salesReport({ to: bangkokDayEnd("2026-02-28") });
    eq("an end with no start runs from the beginning", upTo.totals.count, 2);

    const empty = await salesReport({
      from: bangkokDayStart("2020-01-01"),
      to: bangkokDayEnd("2020-12-31"),
    });
    eq("a window with nothing in it is zero, not an error", empty.totals.sales, 0);
    eq("  with no categories", empty.categories.length, 0);
    eq("  and no count", empty.totals.count, 0);

    // The boundary. A sale at 12:00 Bangkok on 15 January is 05:00 UTC, and a
    // window built from UTC midnights would place it correctly by luck; one
    // built the other way round would not. This pins the direction of the shift.
    const jan15 = await salesReport({
      from: bangkokDayStart("2026-01-15"),
      to: bangkokDayEnd("2026-01-15"),
    });
    eq("a single Bangkok day finds the sale made in it", jan15.totals.count, 1);

    const jan14 = await salesReport({
      from: bangkokDayStart("2026-01-14"),
      to: bangkokDayEnd("2026-01-14"),
    });
    eq("  and the day before finds nothing", jan14.totals.count, 0);
  }

  console.log("\nBANGKOK DAYS");
  {
    const start = bangkokDayStart("2026-08-29");
    eq(
      "a Bangkok day starts at 17:00 UTC the evening before",
      start?.toISOString(),
      "2026-08-28T17:00:00.000Z",
    );
    const end = bangkokDayEnd("2026-08-29");
    eq(
      "  and ends one millisecond before the next",
      end?.toISOString(),
      "2026-08-29T16:59:59.999Z",
    );
    eq("  so the window is exactly one day long", end!.getTime() - start!.getTime(), DAY - 1);

    eq("a missing date is no filter at all", bangkokDayStart(undefined), null);
    eq("so is an empty one", bangkokDayStart(""), null);
    eq("and so is nonsense", bangkokDayStart("not-a-date"), null);
    eq("  including something almost right", bangkokDayStart("2026-8-29"), null);
  }

  await resetFixtures();

  console.log(failures === 0 ? "\nsales report holds" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[sales-report.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
