/**
 * The seller's dashboard: which stage each item is in, and whose money it is.
 *
 * Two risks, and the tests are shaped around them.
 *
 * The first is a stage that lies. "จ่ายแล้ว รอเราส่ง" is the queue a seller
 * works from, so an auction that ended without being paid for must never
 * appear in it, and one whose winner forfeited must fall back out of it. Those
 * edges are asserted directly, on the pure function and again through the
 * database.
 *
 * The second is money that is plausible but wrong. Every figure here is READ
 * from the payment row, so the fixtures carry figures that deliberately do NOT
 * satisfy the obvious formula — VAT is not 7% of the fee, commission is not 10%
 * of net — and the test proves the dashboard reports the stored ones. That is
 * the rule scripts/sales-report.test.mts established for the admin report, and
 * it matters more here: this is the seller's own money.
 *
 * Everything is scoped to this run's fixtures, and every seller fixture comes
 * in a PAIR so that "mine is here" is always asserted alongside "theirs is
 * not" — the arrangement scripts/member-detail.test.mts uses.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/seller-dashboard.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import {
  STAGE_ORDER,
  sellerDashboard,
  sellerStage,
} from "../lib/seller-dashboard";

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

const RUN = randomUUID().slice(0, 8);
const TEST_CATEGORY_PREFIX = "seller-dashboard-test-";

async function resetFixtures() {
  const fixtures = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });

  if (fixtures.length > 0) {
    const ids = fixtures.map((u) => u.id);
    const items = await prisma.auctionItem.findMany({
      where: { OR: [{ sellerId: { in: ids } }, { winnerId: { in: ids } }] },
      select: { id: true },
    });
    const itemIds = items.map((i) => i.id);

    await prisma.referral.deleteMany({
      where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
    await prisma.paymentStrike.deleteMany({ where: { userId: { in: ids } } });
    await prisma.bid.deleteMany({
      where: { OR: [{ auctionItemId: { in: itemIds } }, { bidderId: { in: ids } }] },
    });
    await prisma.verifiedPhone.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const invented = await prisma.category.findMany({
    where: { slug: { startsWith: TEST_CATEGORY_PREFIX } },
    select: { id: true, _count: { select: { auctionItems: true } } },
  });
  const spent = invented.filter((c) => c._count.auctionItems === 0).map((c) => c.id);
  if (spent.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: spent } } });
  }
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

async function testCategory() {
  return prisma.category.create({
    data: { name: `หมวดทดสอบ ${RUN}`, slug: `${TEST_CATEGORY_PREFIX}${RUN}` },
  });
}

type ItemSpec = {
  title?: string;
  status?: "draft" | "active" | "ended" | "cancelled";
  paymentState?: "not_applicable" | "awaiting_payment" | "paid" | "unpaid";
  shippingStatus?: "not_shipped" | "shipped";
  endTime?: Date | null;
  winnerId?: string | null;
  price?: number;
};

async function item(sellerId: string, categoryId: string, spec: ItemSpec = {}) {
  return prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId,
      title: spec.title ?? `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: 100_000,
      currentPrice: spec.price ?? 100_000,
      bidIncrement: 1_000,
      status: spec.status ?? "active",
      paymentState: spec.paymentState ?? "not_applicable",
      shippingStatus: spec.shippingStatus ?? "not_shipped",
      endTime: spec.endTime === undefined ? null : spec.endTime,
      winnerId: spec.winnerId ?? null,
    },
  });
}

type PaymentSpec = {
  amount: number;
  fee: number;
  feeVat: number;
  commission: number;
  sellerNet: number;
  transferFee?: number;
  paidAt?: Date;
  payoutStatus?: "pending" | "transferred";
  status?: "pending" | "successful" | "failed" | "expired";
};

async function payment(itemId: string, payerId: string, spec: PaymentSpec) {
  const status = spec.status ?? "successful";
  const settled = status === "successful";
  return prisma.payment.create({
    data: {
      auctionItemId: itemId,
      payerId,
      method: "promptpay",
      status,
      omiseChargeId: `chrg_test_seller_${randomUUID().slice(0, 12)}`,
      amount: spec.amount,
      fee: settled ? spec.fee : null,
      feeVat: settled ? spec.feeVat : null,
      net: settled ? spec.amount - spec.fee - spec.feeVat : null,
      commission: settled ? spec.commission : null,
      sellerNet: settled ? spec.sellerNet : null,
      transferFee: settled ? (spec.transferFee ?? null) : null,
      paidAt: settled ? (spec.paidAt ?? new Date()) : null,
      payoutStatus: spec.payoutStatus ?? "pending",
    },
  });
}

const DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------- tests */

async function main() {
  await resetFixtures();

  console.log("\nWHAT STAGE AN ITEM IS IN");
  {
    const stage = (
      status: "draft" | "active" | "ended" | "cancelled",
      paymentState: "not_applicable" | "awaiting_payment" | "paid" | "unpaid",
      shippingStatus: "not_shipped" | "shipped" = "not_shipped",
      payoutStatus: "pending" | "transferred" | null = null,
    ) => sellerStage({ status, paymentState, shippingStatus, payoutStatus });

    eq("a running auction is live", stage("active", "not_applicable"), "live");
    eq(
      "an auction that ended with a winner still to pay is waiting on them",
      stage("ended", "awaiting_payment"),
      "awaiting_payment",
    );
    eq(
      "  and is NOT waiting to be posted",
      stage("ended", "awaiting_payment") === "to_ship",
      false,
    );
    eq("paid and unposted is the seller's queue", stage("ended", "paid"), "to_ship");
    eq(
      "posted, money not sent yet",
      stage("ended", "paid", "shipped", "pending"),
      "awaiting_payout",
    );
    eq("posted and paid out is done", stage("ended", "paid", "shipped", "transferred"), "done");

    // The forfeit path. A winner who lets the deadline pass takes a strike and
    // the right moves on; the item goes back to awaiting_payment (or to unpaid
    // when nobody is left). Either way it must fall OUT of the shipping queue.
    eq(
      "a forfeited win goes back to waiting for payment",
      stage("ended", "awaiting_payment", "not_shipped"),
      "awaiting_payment",
    );
    // This one CHANGED when failed deals were given somewhere to go. It used to
    // be null — the item fell off the dashboard, which is exactly the bug: a
    // seller was never told the deal had collapsed and had no way to act on it.
    // It is now a stage of its own, and lib/failed-deal.ts is what a seller does
    // about it.
    eq(
      "  and an auction nobody ever paid for is waiting on the seller",
      stage("ended", "unpaid"),
      "failed",
    );

    eq("a draft is in no stage", stage("draft", "not_applicable"), null);
    eq("a cancelled listing is in no stage", stage("cancelled", "not_applicable"), null);
    eq(
      "an ended auction with no bids is in no stage",
      stage("ended", "not_applicable"),
      null,
    );

    // Money outranks the auction's own status: an item bought outright is paid
    // while its row may still read active until the sweep catches up.
    eq("paid beats whatever the auction status says", stage("active", "paid"), "to_ship");
  }

  const category = await testCategory();
  const seller = await person("ผู้ขาย");
  const rival = await person("ผู้ขายอีกร้าน");
  const buyer = await person("ผู้ซื้อ");

  console.log("\nA SELLER WITH NOTHING");
  {
    const fresh = await person("ผู้ขายมือใหม่");
    const board = await sellerDashboard(fresh.id);

    check("a brand-new seller has a dashboard, not an error", board !== null);
    eq("  nothing listed", board.hasListings, false);
    for (const stage of STAGE_ORDER) {
      eq(`  no items in ${stage}`, board.stages[stage], 0);
    }
    eq("  nothing closing", board.closingSoon, null);
    eq("  no sales", board.earnings.count, 0);
    eq("  no money in", board.earnings.sales, 0);
    eq("  none owing", board.earnings.awaitingPayout, 0);
    eq("  and none sent", board.earnings.paidOut, 0);
    eq("  the thirty-day view is empty too", board.last30.count, 0);
  }

  console.log("\nEVERY STAGE, COUNTED FROM REAL ROWS");
  const now = new Date();
  {
    // One of each, for our seller...
    await item(seller.id, category.id, {
      title: `กำลังประมูล ${RUN}`,
      status: "active",
      endTime: new Date(now.getTime() + 2 * DAY),
    });
    const soonest = await item(seller.id, category.id, {
      title: `ใกล้จบ ${RUN}`,
      status: "active",
      endTime: new Date(now.getTime() + 6 * 60 * 60 * 1000),
    });
    // An auction whose clock has run out but which has not settled yet is not
    // the seller's "next deadline".
    await item(seller.id, category.id, {
      title: `เลยเวลาแล้ว ${RUN}`,
      status: "active",
      endTime: new Date(now.getTime() - DAY),
    });

    await item(seller.id, category.id, {
      title: `รอผู้ชนะจ่าย ${RUN}`,
      status: "ended",
      paymentState: "awaiting_payment",
      winnerId: buyer.id,
    });

    const toShip = await item(seller.id, category.id, {
      title: `รอส่ง ${RUN}`,
      status: "ended",
      paymentState: "paid",
      winnerId: buyer.id,
    });
    await payment(toShip.id, buyer.id, {
      amount: 300_000,
      fee: 10_930,
      feeVat: 800,
      commission: 28_000,
      sellerNet: 260_270,
    });

    const shipped = await item(seller.id, category.id, {
      title: `ส่งแล้ว ${RUN}`,
      status: "ended",
      paymentState: "paid",
      shippingStatus: "shipped",
      winnerId: buyer.id,
    });
    await payment(shipped.id, buyer.id, {
      amount: 200_000,
      fee: 7_286,
      feeVat: 500,
      commission: 19_000,
      sellerNet: 173_214,
    });

    const done = await item(seller.id, category.id, {
      title: `จบดีล ${RUN}`,
      status: "ended",
      paymentState: "paid",
      shippingStatus: "shipped",
      winnerId: buyer.id,
    });
    await payment(done.id, buyer.id, {
      amount: 500_000,
      fee: 18_224,
      feeVat: 1_276,
      // Sent through Omise's Transfers API, which takes its fee OUT of the
      // transfer — so this row's seller share is amount less the gateway, less
      // the transfer fee, less commission. It is the realistic case in which
      // "sales − Omise − commission" is NOT what the seller received.
      transferFee: 2_000,
      commission: 48_000,
      sellerNet: 430_500,
      payoutStatus: "transferred",
    });

    // ...and things that are in no stage at all.
    await item(seller.id, category.id, { title: `ร่าง ${RUN}`, status: "draft" });
    await item(seller.id, category.id, { title: `ยกเลิก ${RUN}`, status: "cancelled" });
    await item(seller.id, category.id, {
      title: `ไม่มีใครจ่าย ${RUN}`,
      status: "ended",
      paymentState: "unpaid",
    });

    // ...and a whole shop belonging to somebody else, in every stage.
    const theirs = await item(rival.id, category.id, {
      title: `ของร้านอื่น ${RUN}`,
      status: "ended",
      paymentState: "paid",
      winnerId: buyer.id,
    });
    await payment(theirs.id, buyer.id, {
      amount: 999_000,
      fee: 30_000,
      feeVat: 2_100,
      commission: 90_000,
      sellerNet: 876_900,
    });
    await item(rival.id, category.id, {
      status: "active",
      endTime: new Date(now.getTime() + 60 * 60 * 1000),
    });

    const board = await sellerDashboard(seller.id, now);

    eq("three auctions running", board.stages.live, 3);
    eq("one winner still to pay", board.stages.awaiting_payment, 1);
    eq("one paid and waiting to be posted", board.stages.to_ship, 1);
    eq("one posted, money still here", board.stages.awaiting_payout, 1);
    eq("one finished end to end", board.stages.done, 1);
    eq("and one deal that fell through", board.stages.failed, 1);

    eq("the next deadline is the soonest one still to come", board.closingSoon?.id, soonest.id);
    check(
      "  not the one whose clock already ran out",
      board.closingSoon?.title === `ใกล้จบ ${RUN}`,
      board.closingSoon?.title,
    );

    // The other shop's item is in the same states and must not be counted here.
    const theirBoard = await sellerDashboard(rival.id, now);
    eq("the other shop's queue is their own", theirBoard.stages.to_ship, 1);
    eq("  and ours is not theirs", board.stages.to_ship, 1);
    eq("  their live auction is theirs alone", theirBoard.stages.live, 1);
    eq("  they have nobody waiting to pay", theirBoard.stages.awaiting_payment, 0);
    eq("  and nothing finished", theirBoard.stages.done, 0);
  }

  console.log("\nA FORFEITED WIN LEAVES THE QUEUE");
  {
    const forfeited = await item(seller.id, category.id, {
      title: `ผิดนัด ${RUN}`,
      status: "ended",
      paymentState: "paid",
      winnerId: buyer.id,
    });
    await payment(forfeited.id, buyer.id, {
      amount: 150_000,
      fee: 5_500,
      feeVat: 400,
      commission: 14_000,
      sellerNet: 130_100,
      status: "expired",
    });

    const before = await sellerDashboard(seller.id, now);
    eq("while it reads paid it is in the queue", before.stages.to_ship, 2);

    // What the payment sweep does when the deadline passes: a strike, and the
    // right to buy goes back to being unclaimed.
    await prisma.paymentStrike.create({
      data: { userId: buyer.id, auctionItemId: forfeited.id, amount: 150_000 },
    });
    await prisma.auctionItem.update({
      where: { id: forfeited.id },
      data: { paymentState: "awaiting_payment", winnerId: null },
    });

    const after = await sellerDashboard(seller.id, now);
    eq("once the win is forfeited it is out of the queue", after.stages.to_ship, 1);
    eq("  and back to waiting for a payer", after.stages.awaiting_payment, 2);
    eq(
      "  the unsettled charge adds nothing to the money",
      after.earnings.count,
      before.earnings.count,
    );
  }

  console.log("\nTHE MONEY IS READ, NOT WORKED OUT");
  {
    const board = await sellerDashboard(seller.id, now);
    const e = board.earnings;

    // Three settled sales: 300,000 + 200,000 + 500,000.
    eq("every settled sale is counted", e.count, 3);
    eq("sales are the sum of amount", e.sales, 1_000_000);
    eq("the Omise fee is the sum of fee", e.omiseFee, 10_930 + 7_286 + 18_224);
    eq("the VAT is the sum of feeVat", e.omiseVat, 800 + 500 + 1_276);
    eq("and the two add up", e.omiseTotal, e.omiseFee + e.omiseVat);
    eq("commission is the sum of commission", e.commission, 28_000 + 19_000 + 48_000);
    eq("the net is the sum of sellerNet", e.net, 260_270 + 173_214 + 430_500);
    eq("the transfer fee is the sum of transferFee", e.transferFee, 2_000);

    // The figures above are DELIBERATELY off-formula: the VAT is not 7% of the
    // fee and the commission is not 10% of net. A dashboard that recomputed
    // either would produce these numbers instead — and they are wrong.
    const derivedVat = Math.round((e.omiseFee * 7) / 100);
    check(
      "the VAT is the stored one, not 7% recomputed from the fee",
      e.omiseVat !== derivedVat,
      `stored ${e.omiseVat}, a recomputation would give ${derivedVat}`,
    );
    const derivedCommission = Math.floor((e.sales - e.omiseTotal) / 10);
    check(
      "the commission is the stored one, not 10% recomputed from net",
      e.commission !== derivedCommission,
      `stored ${e.commission}, a recomputation would give ${derivedCommission}`,
    );
    const derivedNet = e.sales - e.omiseTotal - e.commission;
    check(
      "and the seller's own figure is the stored one too",
      e.net !== derivedNet,
      `stored ${e.net}, a recomputation would give ${derivedNet}`,
    );
    check(
      "  which is what the transfer fee makes impossible to guess",
      e.sales - e.omiseTotal - e.transferFee - e.commission === e.net,
      `${e.sales} - ${e.omiseTotal} - ${e.transferFee} - ${e.commission} vs ${e.net}`,
    );

    eq(
      "what is still owed is the sum of the unsent shares",
      e.awaitingPayout,
      260_270 + 173_214,
    );
    eq("what has gone out is the sum of the sent ones", e.paidOut, 430_500);
    eq("  and the two account for all of it", e.awaitingPayout + e.paidOut, e.net);

    const theirs = await sellerDashboard(rival.id, now);
    eq("the other shop's money is entirely their own", theirs.earnings.sales, 999_000);
    eq("  and none of it is ours", theirs.earnings.net, 876_900);
    check("  our figures did not move", (await sellerDashboard(seller.id, now)).earnings.sales === 1_000_000);
  }

  console.log("\nTHE LAST THIRTY DAYS");
  {
    const old = await item(seller.id, category.id, {
      title: `ขายนานแล้ว ${RUN}`,
      status: "ended",
      paymentState: "paid",
      shippingStatus: "shipped",
      winnerId: buyer.id,
    });
    await payment(old.id, buyer.id, {
      amount: 700_000,
      fee: 25_000,
      feeVat: 1_800,
      commission: 67_000,
      sellerNet: 606_200,
      paidAt: new Date(now.getTime() - 45 * DAY),
      payoutStatus: "transferred",
    });

    const board = await sellerDashboard(seller.id, now);
    eq("all time counts the old sale", board.earnings.count, 4);
    eq("  and its money", board.earnings.sales, 1_700_000);
    eq("thirty days does not", board.last30.count, 3);
    eq("  nor its money", board.last30.sales, 1_000_000);
    eq(
      "  and the window's net is the stored one",
      board.last30.net,
      260_270 + 173_214 + 430_500,
    );
  }

  await resetFixtures();

  console.log("\nNOTHING LEFT BEHIND");
  {
    const left = await prisma.user.count({
      where: { email: { endsWith: "@example.com" } },
    });
    eq("this run's accounts are gone", left, 0);
    const strays = await prisma.category.count({
      where: { slug: { startsWith: TEST_CATEGORY_PREFIX } },
    });
    eq("  and its category with them", strays, 0);
  }

  console.log(failures === 0 ? "\nseller dashboard holds" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[seller-dashboard.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
