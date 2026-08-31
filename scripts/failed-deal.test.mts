/**
 * A deal that fell through: what the seller can do, and what it costs the
 * person who is offered it.
 *
 * The rule this suite exists to protect is the one it must not touch:
 * lib/bidding.ts strikes a winner who misses their deadline and works down the
 * bidders by itself, and none of that changes. Every test here starts from the
 * state that chain LEAVES BEHIND — `ended` + `unpaid`, nobody on the hook — and
 * asserts that the original strike is still there afterwards.
 *
 * The costs are the point of most of it. Accepting an offer and then not paying
 * is an ordinary missed deadline and earns an ordinary strike, through the
 * existing sweep. Declining costs nothing. Ignoring it for 24 hours costs
 * nothing. A test for each, because "nothing" is the kind of promise that
 * quietly stops being true.
 *
 * Scoped to its own fixtures like scripts/sales-report.test.mts, and built in
 * PAIRS like scripts/member-detail.test.mts: another seller with another failed
 * deal exists throughout, so every assertion says both "mine" and "not theirs".
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/failed-deal.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { sweepPaymentDeadlines } from "../lib/bidding";
import {
  acceptSecondChance,
  declineSecondChance,
  expireSecondChances,
  failedDealCount,
  failedDeals,
  offerCandidate,
  offersFor,
  openSecondChance,
  relistSource,
} from "../lib/failed-deal";
import { sellerStage } from "../lib/seller-dashboard";
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

/* ----------------------------------------------------------------- fixtures */

const RUN = randomUUID().slice(0, 8);
const TEST_CATEGORY_PREFIX = "failed-deal-test-";

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

    await prisma.secondChanceOffer.deleteMany({
      where: { OR: [{ auctionItemId: { in: itemIds } }, { bidderId: { in: ids } }] },
    });
    await prisma.referral.deleteMany({
      where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBan.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
    });
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

let category: { id: string; slug: string };

/**
 * An auction that ran, ended, and whose winner is now on the clock.
 *
 * Built the way the real thing is: real bids, a real winner, a real deadline in
 * the past — so that the REAL sweep can be run over it and leave behind exactly
 * the state a production failure leaves behind.
 */
async function auctionWithBidders(
  sellerId: string,
  bidders: { user: { id: string }; amount: number }[],
  title = `ของทดสอบ ${randomUUID().slice(0, 6)}`,
) {
  const top = bidders[bidders.length - 1]!;
  const item = await prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: category.id,
      title,
      description: "รายละเอียดเดิม",
      images: [],
      condition: "used",
      startPrice: 100_000,
      currentPrice: top.amount,
      buyNowPrice: 900_000,
      bidIncrement: 1_000,
      status: "ended",
      endedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endReason: "expired",
      winnerId: top.user.id,
      paymentState: "awaiting_payment",
      // Already lapsed, so the real sweep will act on it.
      paymentDueAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  });

  for (const bidder of bidders) {
    await prisma.bid.create({
      data: { auctionItemId: item.id, bidderId: bidder.user.id, amount: bidder.amount },
    });
  }
  return item;
}

/* -------------------------------------------------------------------- tests */

async function main() {
  await resetFixtures();
  category = await prisma.category.create({
    data: { name: `หมวดทดสอบ ${RUN}`, slug: `${TEST_CATEGORY_PREFIX}${RUN}` },
  });

  const seller = await person("ผู้ขาย");
  const rivalSeller = await person("ผู้ขายอีกร้าน");

  console.log("\nWHAT THE EXISTING SWEEP LEAVES BEHIND");
  let failedItemId = "";
  let secondPlace = { id: "" };
  {
    const winner = await person("ผู้ชนะที่เบี้ยว");
    const second = await person("อันดับสอง");
    secondPlace = second;
    const item = await auctionWithBidders(
      seller.id,
      [
        { user: second, amount: 150_000 },
        { user: winner, amount: 200_000 },
      ],
      `ดีลล้ม ${RUN}`,
    );

    // The real thing, untouched by this feature: it strikes the winner and
    // hands the item to the next eligible bidder.
    await sweepPaymentDeadlines();

    const afterFirst = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { winnerId: true, paymentState: true, currentPrice: true },
    });
    eq("the winner who missed the deadline is struck", 
      await prisma.paymentStrike.count({ where: { userId: winner.id, auctionItemId: item.id } }), 1);
    eq("  and the item is handed to the next bidder, as it always was",
      afterFirst.winnerId, second.id);
    eq("    at their own bid, not the forfeited one", afterFirst.currentPrice, 150_000);

    // The second bidder lets it lapse too. Now the chain is out of people.
    await prisma.auctionItem.update({
      where: { id: item.id },
      data: { paymentDueAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await sweepPaymentDeadlines();

    const stranded = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { status: true, paymentState: true, winnerId: true },
    });
    eq("with nobody left, the item is stranded", stranded.paymentState, "unpaid");
    eq("  with no winner at all", stranded.winnerId, null);
    eq("  and it stays ended", stranded.status, "ended");
    eq("both people who walked away are struck", 
      await prisma.paymentStrike.count({ where: { auctionItemId: item.id } }), 2);

    // THIS is the state the feature is about.
    eq(
      "the seller's dashboard now calls that a failed deal",
      sellerStage({
        status: "ended",
        paymentState: "unpaid",
        shippingStatus: "not_shipped",
        payoutStatus: null,
      }),
      "failed",
    );
    eq("  and it is waiting on this seller", await failedDealCount(seller.id), 1);
    eq("  not on any other", await failedDealCount(rivalSeller.id), 0);
    failedItemId = item.id;
  }

  console.log("\nNOBODY LEFT TO OFFER IT TO");
  {
    // Everyone who bid on it has forfeited it, which is exactly why it got
    // here: the chain does not stop while an eligible bidder remains.
    eq("there is no candidate", await offerCandidate(failedItemId), null);
    const result = await openSecondChance(failedItemId, seller.id);
    eq("  so the offer is refused", result.ok ? "ok" : result.reason, "no_candidate");

    const [deal] = await failedDeals(seller.id);
    eq("  and the seller is shown no offer button", deal?.candidate, null);
    eq("  but the deal is still theirs to decide", deal?.itemId, failedItemId);
  }

  console.log("\nOFFERING IT ON");
  let offerId = "";
  let offered = { id: "" };
  let offerItemId = "";
  {
    // A failed deal that still has an eligible bidder behind it. Reaching this
    // through the sweep is impossible by construction — the chain would have
    // offered it to them — so it is built directly, which is also what a
    // changed chain would produce.
    const walker = await person("คนที่เบี้ยว");
    const runnerUp = await person("อันดับสองที่ยังดีอยู่");
    offered = runnerUp;
    const item = await auctionWithBidders(
      seller.id,
      [
        { user: runnerUp, amount: 120_000 },
        { user: walker, amount: 180_000 },
      ],
      `รอเสนอ ${RUN}`,
    );
    // Strike the walker and strand the item, without letting the chain hand it
    // to the runner-up.
    await prisma.paymentStrike.create({
      data: { userId: walker.id, auctionItemId: item.id, amount: 180_000 },
    });
    await prisma.auctionItem.update({
      where: { id: item.id },
      data: { paymentState: "unpaid", winnerId: null, paymentDueAt: null },
    });
    offerItemId = item.id;

    const candidate = await offerCandidate(item.id);
    eq("the next eligible bidder is found", candidate?.bidderId, runnerUp.id);
    eq("  at the price they actually bid", candidate?.amount, 120_000);

    const [deal] = (await failedDeals(seller.id)).filter((d) => d.itemId === item.id);
    eq("the seller is shown the amount", deal?.candidate?.amount, 120_000);

    const result = await openSecondChance(item.id, seller.id);
    check("the offer is made", result.ok, JSON.stringify(result));
    if (result.ok) {
      offerId = result.offerId;
      eq("  to that bidder", result.bidderId, runnerUp.id);
      eq("  at their own price", result.amount, 120_000);
      check(
        "  and it stands for 24 hours",
        Math.abs(result.expiresAt.getTime() - (Date.now() + 24 * 60 * 60 * 1000)) < 60_000,
        `${result.expiresAt.toISOString()}`,
      );
    }

    eq("it is waiting for them to answer", (await offersFor(runnerUp.id)).length, 1);
    eq("  and for nobody else", (await offersFor(walker.id)).length, 0);
  }

  console.log("\nONE LIVE OFFER PER ITEM, ENFORCED BY THE DATABASE");
  {
    const again = await openSecondChance(offerItemId, seller.id);
    eq("a second offer on the same item is refused", again.ok ? "ok" : again.reason, "offer_live");

    // Not by the check above it — by the unique index. Writing one directly
    // must fail the same way.
    let raised = false;
    try {
      await prisma.secondChanceOffer.create({
        data: {
          auctionItemId: offerItemId,
          bidderId: secondPlace.id,
          amount: 1,
          liveForItemId: offerItemId,
          expiresAt: new Date(Date.now() + 1000),
        },
      });
    } catch {
      raised = true;
    }
    check("  and the database refuses it too", raised);

    const relist = await relistSource(offerItemId, seller.id);
    eq(
      "the seller cannot relist it while it is promised to somebody",
      relist.ok ? "ok" : relist.reason,
      "offer_live",
    );
  }

  console.log("\nSAYING NO COSTS NOTHING");
  {
    const before = await prisma.paymentStrike.count({ where: { userId: offered.id } });
    const result = await declineSecondChance(offerId, offered.id);
    check("the offer can be declined", result.ok, JSON.stringify(result));
    eq(
      "  and it costs the person nothing",
      await prisma.paymentStrike.count({ where: { userId: offered.id } }),
      before,
    );

    const item = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: offerItemId },
      select: { paymentState: true, winnerId: true },
    });
    eq("the item goes back to waiting on the seller", item.paymentState, "unpaid");
    eq("  with still no winner", item.winnerId, null);

    const [deal] = (await failedDeals(seller.id)).filter((d) => d.itemId === offerItemId);
    eq("  and no offer out", deal?.offer, null);
    eq("  so the seller can offer it again", deal?.candidate?.bidderId, offered.id);

    const closed = await prisma.secondChanceOffer.findUniqueOrThrow({
      where: { id: offerId },
      select: { status: true, liveForItemId: true },
    });
    eq("the declined offer is recorded as declined", closed.status, "declined");
    eq("  and stops holding the item", closed.liveForItemId, null);

    // Now it can be relisted again.
    const relist = await relistSource(offerItemId, seller.id);
    check("the relist route is open again", relist.ok);
  }

  console.log("\nIGNORING IT COSTS NOTHING EITHER");
  {
    const fresh = await openSecondChance(offerItemId, seller.id);
    check("a fresh offer goes out", fresh.ok, JSON.stringify(fresh));

    const before = await prisma.paymentStrike.count({ where: { userId: offered.id } });
    // Move its deadline into the past, exactly as 24 hours passing would.
    await prisma.secondChanceOffer.updateMany({
      where: { liveForItemId: offerItemId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const lapsed = await expireSecondChances();
    eq("the sweep closes it", lapsed.filter((o) => o.itemId === offerItemId).length, 1);
    eq(
      "  and still nobody is struck for it",
      await prisma.paymentStrike.count({ where: { userId: offered.id } }),
      before,
    );
    eq(
      "  it is recorded as expired, not declined",
      (await prisma.secondChanceOffer.findFirstOrThrow({
        where: { auctionItemId: offerItemId },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      })).status,
      "expired",
    );
    const [deal] = (await failedDeals(seller.id)).filter((d) => d.itemId === offerItemId);
    eq("  and the item is the seller's decision again", deal?.offer, null);
  }

  console.log("\nSAYING YES IS AN ORDINARY WIN");
  {
    const result = await openSecondChance(offerItemId, seller.id);
    check("a third offer goes out", result.ok);
    const id = result.ok ? result.offerId : "";

    const accepted = await acceptSecondChance(id, offered.id);
    check("it can be accepted", accepted.ok, JSON.stringify(accepted));

    const item = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: offerItemId },
      select: { winnerId: true, currentPrice: true, paymentState: true, paymentDueAt: true },
    });
    eq("the accepter becomes the winner", item.winnerId, offered.id);
    eq("  at the price they bid", item.currentPrice, 120_000);
    eq("  on the ordinary payment path", item.paymentState, "awaiting_payment");
    check(
      "  with the ordinary 24-hour deadline",
      item.paymentDueAt !== null &&
        Math.abs(item.paymentDueAt.getTime() - (Date.now() + 24 * 60 * 60 * 1000)) < 60_000,
      `${item.paymentDueAt?.toISOString()}`,
    );
    eq(
      "the item leaves the failed pile",
      sellerStage({
        status: "ended",
        paymentState: item.paymentState,
        shippingStatus: "not_shipped",
        payoutStatus: null,
      }),
      "awaiting_payment",
    );
    eq("  and out of the seller's decisions", await failedDealCount(seller.id), 1);
  }

  console.log("\nACCEPTING AND THEN NOT PAYING IS A STRIKE, LIKE ANY OTHER");
  {
    const before = await prisma.paymentStrike.count({ where: { userId: offered.id } });
    await prisma.auctionItem.update({
      where: { id: offerItemId },
      data: { paymentDueAt: new Date(Date.now() - 60 * 1000) },
    });

    // The existing sweep, which knows nothing about second chances.
    await sweepPaymentDeadlines();

    eq(
      "the accepter is struck by the existing sweep",
      await prisma.paymentStrike.count({ where: { userId: offered.id } }),
      before + 1,
    );
    const item = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: offerItemId },
      select: { paymentState: true, winnerId: true },
    });
    eq("  and the item is a failed deal once more", item.paymentState, "unpaid");
    eq("  with nobody on the hook", item.winnerId, null);
    eq(
      "  and now nobody left to offer it to",
      await offerCandidate(offerItemId),
      null,
    );
  }

  console.log("\nWHO MAY NOT BE OFFERED ANYTHING");
  {
    const walker = await person("เบี้ยวอีกคน");
    const banned = await person("โดนแบนบิด");
    const struck = await person("สามสไตรก์");
    const good = await person("คนดี");

    const item = await auctionWithBidders(
      seller.id,
      [
        { user: good, amount: 110_000 },
        { user: struck, amount: 130_000 },
        { user: banned, amount: 160_000 },
        { user: walker, amount: 210_000 },
      ],
      `กรองผู้รับ ${RUN}`,
    );
    await prisma.paymentStrike.create({
      data: { userId: walker.id, auctionItemId: item.id, amount: 210_000 },
    });
    await prisma.auctionItem.update({
      where: { id: item.id },
      data: { paymentState: "unpaid", winnerId: null, paymentDueAt: null },
    });

    // An admin ban on bidding — a rule the automatic chain does not apply.
    const admin = await person("แอดมิน");
    await prisma.userBan.create({
      data: {
        userId: banned.id,
        kind: "bidding",
        reason: "ตรวจสอบพฤติกรรม",
        bannedById: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Three strikes on other auctions.
    for (let i = 0; i < STRIKE_LIMIT; i++) {
      const other = await auctionWithBidders(rivalSeller.id, [{ user: struck, amount: 50_000 + i }]);
      await prisma.paymentStrike.create({
        data: { userId: struck.id, auctionItemId: other.id, amount: 50_000 },
      });
    }

    const candidate = await offerCandidate(item.id);
    eq("the highest bidder is skipped — he is the one who walked away", 
      candidate?.bidderId === walker.id, false);
    eq("  the bid-banned one is skipped", candidate?.bidderId === banned.id, false);
    eq("  the struck-out one is skipped", candidate?.bidderId === struck.id, false);
    eq("  and the offer goes to the next one who is fine", candidate?.bidderId, good.id);
    eq("    at their own bid", candidate?.amount, 110_000);

    // The seller is never a candidate on their own item.
    await prisma.bid.create({
      data: { auctionItemId: item.id, bidderId: rivalSeller.id, amount: 500_000 },
    });
    const stillGood = await offerCandidate(item.id);
    eq("a bid from another seller is fine", stillGood?.bidderId, rivalSeller.id);
  }

  console.log("\nSOMEBODY ELSE'S OFFER IS NOT YOURS TO ANSWER");
  {
    const owner = await person("เจ้าของข้อเสนอ");
    const stranger = await person("คนแปลกหน้า");
    const walker = await person("เบี้ยวอีกที");
    const item = await auctionWithBidders(
      seller.id,
      [
        { user: owner, amount: 140_000 },
        { user: walker, amount: 190_000 },
      ],
      `ของคนอื่น ${RUN}`,
    );
    await prisma.paymentStrike.create({
      data: { userId: walker.id, auctionItemId: item.id, amount: 190_000 },
    });
    await prisma.auctionItem.update({
      where: { id: item.id },
      data: { paymentState: "unpaid", winnerId: null, paymentDueAt: null },
    });

    const made = await openSecondChance(item.id, seller.id);
    check("an offer goes to the runner-up", made.ok);
    const id = made.ok ? made.offerId : "";

    const stolen = await acceptSecondChance(id, stranger.id);
    eq("a stranger cannot accept it", stolen.ok ? "ok" : stolen.reason, "not_yours");
    const refused = await declineSecondChance(id, stranger.id);
    eq("  nor decline it", refused.ok ? "ok" : refused.reason, "not_yours");
    eq(
      "  and it is still open for the person it was made to",
      (await offersFor(owner.id)).length,
      1,
    );

    // Another seller cannot offer somebody else's item on either.
    const hijack = await openSecondChance(item.id, rivalSeller.id);
    eq("another seller cannot offer this item", hijack.ok ? "ok" : hijack.reason, "not_found");
    const hijackRelist = await relistSource(item.id, rivalSeller.id);
    eq("  nor relist it", hijackRelist.ok ? "ok" : hijackRelist.reason, "not_found");
  }

  console.log("\nLISTING IT AGAIN");
  {
    const source = await relistSource(failedItemId, seller.id);
    check("the old listing can be read back", source.ok, JSON.stringify(source));
    if (source.ok) {
      eq("  its title comes over", source.source.title, `ดีลล้ม ${RUN}`);
      eq("  its description", source.source.description, "รายละเอียดเดิม");
      eq("  its category", source.source.categorySlug, category.slug);
      eq("  its condition", source.source.condition, "used");
      eq("  its starting price", source.source.startPrice, 100_000);
      eq("  and its buy-now price", source.source.buyNowPrice, 900_000);
    }

    // The relist itself is the ordinary listing flow, so what matters here is
    // that using it leaves the old listing exactly as it was.
    const before = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: failedItemId },
      select: { status: true, paymentState: true, title: true },
    });
    const bidsBefore = await prisma.bid.count({ where: { auctionItemId: failedItemId } });
    const strikesBefore = await prisma.paymentStrike.count({
      where: { auctionItemId: failedItemId },
    });

    const fresh = await prisma.auctionItem.create({
      data: {
        sellerId: seller.id,
        categoryId: category.id,
        title: before.title,
        description: "รายละเอียดเดิม",
        images: [],
        condition: "used",
        startPrice: 100_000,
        currentPrice: 100_000,
        bidIncrement: 1_000,
        status: "draft",
      },
    });

    const after = await prisma.auctionItem.findUniqueOrThrow({
      where: { id: failedItemId },
      select: { status: true, paymentState: true, title: true },
    });
    eq("the new listing is a different item", fresh.id === failedItemId, false);
    eq("the old one is untouched", after.status, before.status);
    eq("  including its state", after.paymentState, before.paymentState);
    eq("  its bids are still there", await prisma.bid.count({ where: { auctionItemId: failedItemId } }), bidsBefore);
    eq(
      "  and so are its strikes",
      await prisma.paymentStrike.count({ where: { auctionItemId: failedItemId } }),
      strikesBefore,
    );
  }

  console.log("\nONE SELLER'S DECISIONS ARE THEIR OWN");
  {
    const walker = await person("เบี้ยวร้านอื่น");
    const other = await auctionWithBidders(
      rivalSeller.id,
      [{ user: walker, amount: 170_000 }],
      `ของร้านอื่น ${RUN}`,
    );
    await prisma.paymentStrike.create({
      data: { userId: walker.id, auctionItemId: other.id, amount: 170_000 },
    });
    await prisma.auctionItem.update({
      where: { id: other.id },
      data: { paymentState: "unpaid", winnerId: null, paymentDueAt: null },
    });

    const mine = await failedDeals(seller.id);
    const theirs = await failedDeals(rivalSeller.id);
    check("the other shop's failed deal is theirs", theirs.some((d) => d.itemId === other.id));
    check("  and not in ours", mine.every((d) => d.itemId !== other.id));
    check("  ours are not in theirs", theirs.every((d) => d.itemId !== failedItemId));
  }

  await resetFixtures();

  console.log("\nNOTHING LEFT BEHIND");
  {
    eq(
      "this run's accounts are gone",
      await prisma.user.count({ where: { email: { endsWith: "@example.com" } } }),
      0,
    );
    eq(
      "  and its category with them",
      await prisma.category.count({ where: { slug: { startsWith: TEST_CATEGORY_PREFIX } } }),
      0,
    );
  }

  console.log(failures === 0 ? "\nfailed deals hold" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[failed-deal.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
