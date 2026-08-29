/**
 * Bidding and settlement, as they behave TODAY.
 *
 * Written and passed against unmodified lib/bidding.ts before the buy-now
 * button touched it, so that "ordinary bidding still works" is a measurement
 * rather than a claim. Every assertion here must still hold afterwards,
 * unaltered.
 *
 * No gateway, no network: bidding is pure database work, so this needs only a
 * throwaway PostgreSQL.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server \
 *     scripts/bidding-regression.test.mts
 *
 * `.mts`, not `.ts`: the file has top-level await, which tsx can only load as
 * ESM, and a `.ts` under this tsconfig is required as CJS.
 *
 * `--conditions=react-server` is required: lib/bidding.ts imports "server-only",
 * whose export map resolves to an empty module under that condition and to a
 * throwing one otherwise.
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  endAuctionBySeller,
  forfeitAndReoffer,
  placeBid,
  settleAllExpired,
  settleIfExpired,
} from "../lib/bidding";
import {
  checkBidAmount,
  isBuyNowBid,
  minimumBid,
  PAYMENT_WINDOW_MS,
} from "../lib/auction-rules";
import { STRIKE_LIMIT } from "../lib/strikes";

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

/**
 * Clear what earlier runs left behind, for the same reason the payment suites
 * do: a test whose result depends on its own history is not a measurement.
 * Scoped to @example.com, which only the fixtures use.
 */
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
  await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.paymentStrike.deleteMany({ where: { userId: { in: ids } } });
  await prisma.bid.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function user(tag: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
      name: `ผู้ใช้ ${tag}`,
    },
  });
}

type ItemOptions = {
  startPrice?: number;
  buyNowPrice?: number | null;
  bidIncrement?: number;
  endTime?: Date | null;
  status?: "draft" | "active" | "ended" | "cancelled";
};

async function auction(sellerId: string, options: ItemOptions = {}) {
  const category = await prisma.category.upsert({
    where: { slug: "amulets" },
    update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  const startPrice = options.startPrice ?? 100_000;
  return prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: category.id,
      title: `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice,
      currentPrice: startPrice,
      bidIncrement: options.bidIncrement ?? 1_000,
      buyNowPrice: options.buyNowPrice ?? null,
      endTime: options.endTime ?? null,
      status: options.status ?? "active",
    },
  });
}

/** A bidder with a verified phone is not required by lib/bidding — the action
 *  layer checks that — so fixtures here are plain accounts. */
await resetFixtures();

console.log("\nTHE AMOUNT RULES (pure)");
{
  const ctx = { currentPrice: 100_000, bidIncrement: 1_000, buyNowPrice: null };
  eq("minimum is current + increment", minimumBid(ctx), 101_000);
  eq("below the minimum is refused", checkBidAmount(100_500, ctx), "below_minimum");
  eq("the minimum itself is accepted", checkBidAmount(101_000, ctx), null);
  eq("a non-integer is refused", checkBidAmount(101_000.5, ctx), "not_an_amount");
  eq("zero is refused", checkBidAmount(0, ctx), "not_an_amount");
  eq("with no buy-now nothing wins outright", isBuyNowBid(9_999_999, ctx), false);
}
{
  const ctx = { currentPrice: 100_000, bidIncrement: 1_000, buyNowPrice: 150_000 };
  eq("above buy-now is refused", checkBidAmount(150_001, ctx), "above_buy_now");
  eq("buy-now exactly is accepted", checkBidAmount(150_000, ctx), null);
  eq("and it wins outright", isBuyNowBid(150_000, ctx), true);
}
{
  // The increment would step past buy-now, so buy-now becomes the only amount.
  const ctx = { currentPrice: 149_500, bidIncrement: 1_000, buyNowPrice: 150_000 };
  eq("a step past buy-now collapses the minimum to buy-now", minimumBid(ctx), 150_000);
  eq("so buy-now is the only legal amount", checkBidAmount(150_000, ctx), null);
  eq("and one satang under is still too low", checkBidAmount(149_999, ctx), "below_minimum");
}

console.log("\nAN ORDINARY BID");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id);

  const result = await placeBid(item.id, bidder.id, 101_000);
  check("is accepted", result.ok, JSON.stringify(result));
  eq("and does not end the auction", result.ok && result.wonByBuyNow, false);

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("currentPrice moved to the bid", after.currentPrice, 101_000);
  eq("status is still active", after.status, "active");
  eq("there is no winner yet", after.winnerId, null);
  eq("and no payment clock is running", after.paymentDueAt, null);

  const bids = await prisma.bid.count({ where: { auctionItemId: item.id } });
  eq("one bid was recorded", bids, 1);
}

console.log("\nBIDS THAT ARE REFUSED");
{
  const seller = await user("s");
  const other = await user("b");
  const item = await auction(seller.id);

  // Refused as "shill", not "own_item": findShillLink runs before the
  // transaction opens and returns "identity" as soon as bidder === seller, so
  // the own_item branch inside the lock is unreachable through placeBid. It is
  // left there as a backstop and this records which one actually fires.
  eq("the seller cannot bid on their own item",
    ((await placeBid(item.id, seller.id, 101_000)) as { reason?: string }).reason,
    "shill");

  eq("an unknown item is not_found",
    ((await placeBid(randomUUID(), other.id, 101_000)) as { reason?: string }).reason,
    "not_found");

  await placeBid(item.id, other.id, 101_000);
  eq("the leader cannot bid against themselves",
    ((await placeBid(item.id, other.id, 102_000)) as { reason?: string }).reason,
    "already_leading");

  const third = await user("c");
  eq("below the minimum is refused",
    ((await placeBid(item.id, third.id, 101_500)) as { reason?: string }).reason,
    "below_minimum");
}
{
  const seller = await user("s");
  const bidder = await user("b");
  const draft = await auction(seller.id, { status: "draft" });
  eq("a draft cannot be bid on",
    ((await placeBid(draft.id, bidder.id, 101_000)) as { reason?: string }).reason,
    "not_active");

  const ended = await auction(seller.id, { status: "ended" });
  eq("an ended auction cannot be bid on",
    ((await placeBid(ended.id, bidder.id, 101_000)) as { reason?: string }).reason,
    "not_active");
}
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, { buyNowPrice: 150_000 });
  eq("above buy-now is refused",
    ((await placeBid(item.id, bidder.id, 150_001)) as { reason?: string }).reason,
    "above_buy_now");
}

console.log("\nA BID AFTER THE CLOCK RAN OUT");
{
  const seller = await user("s");
  const first = await user("b");
  const late = await user("c");
  const item = await auction(seller.id, { endTime: new Date(Date.now() + 60_000) });

  await placeBid(item.id, first.id, 101_000);
  await prisma.auctionItem.update({
    where: { id: item.id },
    data: { endTime: new Date(Date.now() - 1_000) },
  });

  const result = await placeBid(item.id, late.id, 102_000);
  eq("is refused as expired", (result as { reason?: string }).reason, "expired");

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("and settles the auction on the spot", after.status, "ended");
  eq("with the earlier leader as winner", after.winnerId, first.id);
  eq("closed because time ran out", after.endReason, "expired");
  eq("the winner owes money", after.paymentState, "awaiting_payment");
  check("and has 24 hours to pay",
    Math.abs((after.paymentDueAt!.getTime() - after.endedAt!.getTime()) - PAYMENT_WINDOW_MS) < 2_000,
    String(after.paymentDueAt));
  eq("the late bid was not recorded",
    await prisma.bid.count({ where: { auctionItemId: item.id } }), 1);
}

console.log("\nBUY-NOW BY TYPING THE EXACT AMOUNT (what exists today)");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, { buyNowPrice: 150_000 });

  const result = await placeBid(item.id, bidder.id, 150_000);
  check("is accepted", result.ok, JSON.stringify(result));
  eq("and reports winning outright", result.ok && result.wonByBuyNow, true);
  eq("at the buy-now price", result.ok && result.amount, 150_000);

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("the auction ended", after.status, "ended");
  eq("because it was bought outright", after.endReason, "buy_now");
  eq("the buyer is the winner", after.winnerId, bidder.id);
  eq("the price is the buy-now price", after.currentPrice, 150_000);
  eq("and they owe money", after.paymentState, "awaiting_payment");
  check("with the same 24-hour clock as any other win",
    Math.abs((after.paymentDueAt!.getTime() - after.endedAt!.getTime()) - PAYMENT_WINDOW_MS) < 2_000,
    String(after.paymentDueAt));
  eq("the purchase is recorded as a bid",
    await prisma.bid.count({ where: { auctionItemId: item.id, amount: 150_000 } }), 1);
}
{
  // The collapsed-minimum case end to end: one satang under buy-now, with an
  // increment that would overshoot it.
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, {
    startPrice: 149_500,
    bidIncrement: 1_000,
    buyNowPrice: 150_000,
  });
  const result = await placeBid(item.id, bidder.id, 150_000);
  check("buy-now is reachable even when the step would overshoot", result.ok, JSON.stringify(result));
  eq("and it ends the auction",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).status, "ended");
}

console.log("\nTWO BIDS AT ONCE");
{
  const seller = await user("s");
  const a = await user("a");
  const b = await user("b");
  const item = await auction(seller.id);

  // Both read the same starting price, then race for it.
  const [ra, rb] = await Promise.all([
    placeBid(item.id, a.id, 101_000),
    placeBid(item.id, b.id, 101_000),
  ]);

  const winners = [ra, rb].filter((r) => r.ok).length;
  eq("exactly one of two bids at the same amount is accepted", winners, 1);
  eq("and only one bid row exists",
    await prisma.bid.count({ where: { auctionItemId: item.id } }), 1);
  eq("at the price that was accepted",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).currentPrice,
    101_000);
}

console.log("\nTHE SELLER CLOSES EARLY");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id);
  await placeBid(item.id, bidder.id, 101_000);

  const result = await endAuctionBySeller(item.id, seller.id);
  check("is allowed", result.ok, JSON.stringify(result));
  eq("with the top bidder as winner", result.ok && result.winnerId, bidder.id);

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("the auction ended", after.status, "ended");
  eq("because the seller ended it", after.endReason, "seller_ended");
  eq("and the winner owes money", after.paymentState, "awaiting_payment");
}
{
  const seller = await user("s");
  const item = await auction(seller.id);
  const result = await endAuctionBySeller(item.id, seller.id);
  eq("closing an auction nobody bid on cancels it", result.ok && result.status, "cancelled");
  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("status is cancelled", after.status, "cancelled");
  eq("nothing is owed", after.paymentState, "not_applicable");
}
{
  const seller = await user("s");
  const stranger = await user("x");
  const item = await auction(seller.id);
  eq("someone else cannot close it",
    ((await endAuctionBySeller(item.id, stranger.id)) as { reason?: string }).reason,
    "not_found");
}

console.log("\nEXPIRY SWEEPS");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, { endTime: new Date(Date.now() - 1_000) });
  await prisma.bid.create({
    data: { auctionItemId: item.id, bidderId: bidder.id, amount: 101_000 },
  });

  check("settleIfExpired closes a lapsed auction", await settleIfExpired(item.id));
  check("and is a no-op the second time", (await settleIfExpired(item.id)) === false);
  eq("the winner is the top bidder",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).winnerId,
    bidder.id);

  const live = await auction(seller.id, { endTime: new Date(Date.now() + 3_600_000) });
  check("a live auction is left alone", (await settleIfExpired(live.id)) === false);

  const lapsed = await auction(seller.id, { endTime: new Date(Date.now() - 1_000) });
  const swept = await settleAllExpired();
  check("settleAllExpired finds it", swept.includes(lapsed.id), JSON.stringify(swept));
}

console.log("\nA WINNER WHO DOES NOT PAY");
{
  const seller = await user("s");
  const top = await user("b");
  const second = await user("c");
  const item = await auction(seller.id);
  await placeBid(item.id, second.id, 101_000);
  await placeBid(item.id, top.id, 102_000);
  await endAuctionBySeller(item.id, seller.id);

  const result = await forfeitAndReoffer(item.id);
  eq("the winner is struck", result.struckUserId, top.id);
  eq("and it passes to the next bidder", result.nextWinnerId, second.id);

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("at THEIR bid, not the forfeited price", after.currentPrice, 101_000);
  eq("the new winner owes money", after.paymentState, "awaiting_payment");
  eq("one strike exists",
    await prisma.paymentStrike.count({ where: { userId: top.id, auctionItemId: item.id } }), 1);

  await forfeitAndReoffer(item.id);
  eq("running the sweep twice does not strike the same person twice",
    await prisma.paymentStrike.count({ where: { userId: top.id, auctionItemId: item.id } }), 1);
}
{
  const seller = await user("s");
  const only = await user("b");
  const item = await auction(seller.id);
  await placeBid(item.id, only.id, 101_000);
  await endAuctionBySeller(item.id, seller.id);
  await forfeitAndReoffer(item.id);

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("with nobody left the item goes unpaid", after.paymentState, "unpaid");
  eq("and has no winner", after.winnerId, null);
}

console.log("\nA BANNED BIDDER");
{
  const seller = await user("s");
  const banned = await user("b");
  const item = await auction(seller.id);

  for (let i = 0; i < STRIKE_LIMIT; i++) {
    const past = await auction(seller.id);
    await prisma.paymentStrike.create({
      data: { userId: banned.id, auctionItemId: past.id, amount: 100_000 },
    });
  }

  const result = await placeBid(item.id, banned.id, 101_000);
  eq("is refused", (result as { reason?: string }).reason, "banned");
  eq("and told how many strikes", (result as { strikes?: number }).strikes, STRIKE_LIMIT);
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nbidding holds" : `\n${failures} REGRESSION(S)`);
process.exit(failures === 0 ? 0 : 1);
