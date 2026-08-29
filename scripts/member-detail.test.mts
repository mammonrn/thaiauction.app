/**
 * One member's page: is every section about that member, and only them.
 *
 * The failure this guards against is quiet and embarrassing — a section that
 * joins on the wrong side and shows one person another person's payments. So
 * every fixture here is built in PAIRS: whatever the member under test has, a
 * second account has one too, and each assertion says both "mine is here" and
 * "theirs is not".
 *
 * Scoped to its own fixtures throughout, the way scripts/sales-report.test.mts
 * is: it runs against whatever DATABASE_URL points at, so no assertion may
 * depend on a count of the whole table.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/member-detail.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { bidOutcome, memberDetail, SECTION_LIMIT } from "../lib/member-detail";
import { memberRole } from "../lib/members";
import { ensureReferralCode, recordSignupReferral, markReferralVerified } from "../lib/referral";

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
const TEST_CATEGORY_PREFIX = "member-detail-test-";

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

    // Referrals first, then everything hanging off the items, then the items,
    // then the people. The order matters and is the same one every suite in
    // this directory follows.
    await prisma.referral.deleteMany({
      where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBan.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
    });
    await prisma.sellerVerification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { reviewedById: { in: ids } }] },
    });
    await prisma.verifiedPhone.deleteMany({ where: { userId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
    await prisma.paymentStrike.deleteMany({ where: { userId: { in: ids } } });
    await prisma.bid.deleteMany({
      where: { OR: [{ auctionItemId: { in: itemIds } }, { bidderId: { in: ids } }] },
    });
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
    data: {
      name: `หมวดทดสอบ ${RUN}`,
      slug: `${TEST_CATEGORY_PREFIX}${RUN}`,
    },
  });
}

async function listing(
  sellerId: string,
  categoryId: string,
  overrides: {
    title?: string;
    status?: "draft" | "active" | "ended" | "cancelled";
    winnerId?: string | null;
    price?: number;
  } = {},
) {
  return prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId,
      title: overrides.title ?? `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: 100_000,
      currentPrice: overrides.price ?? 100_000,
      bidIncrement: 1_000,
      status: overrides.status ?? "active",
      winnerId: overrides.winnerId ?? null,
    },
  });
}

async function bid(itemId: string, bidderId: string, amount: number) {
  return prisma.bid.create({
    data: { auctionItemId: itemId, bidderId, amount },
  });
}

async function payment(
  itemId: string,
  payerId: string,
  overrides: {
    amount?: number;
    status?: "pending" | "successful" | "failed" | "expired";
    paid?: boolean;
    payoutStatus?: "pending" | "transferred";
  } = {},
) {
  const amount = overrides.amount ?? 200_000;
  const status = overrides.status ?? "successful";
  const paid = overrides.paid ?? status === "successful";
  return prisma.payment.create({
    data: {
      auctionItemId: itemId,
      payerId,
      method: "promptpay",
      status,
      omiseChargeId: `chrg_test_detail_${randomUUID().slice(0, 12)}`,
      amount,
      sellerNet: paid ? amount - 20_000 : null,
      paidAt: paid ? new Date() : null,
      payoutStatus: overrides.payoutStatus ?? "pending",
    },
  });
}

/* -------------------------------------------------------------------- tests */

async function main() {
  await resetFixtures();

  console.log("\nWHAT A BID CAME TO");
  {
    // Pure, so it can be asked every question rather than only the ones a
    // fixture happens to produce.
    eq(
      "the top bidder on a running auction is leading",
      bidOutcome({ userId: "a", status: "active", winnerId: null, topBidderId: "a" }),
      "leading",
    );
    eq(
      "  and anyone else has been outbid",
      bidOutcome({ userId: "b", status: "active", winnerId: null, topBidderId: "a" }),
      "outbid",
    );
    eq(
      "the winner of an ended auction won it",
      bidOutcome({ userId: "a", status: "ended", winnerId: "a", topBidderId: "a" }),
      "won",
    );
    eq(
      "  and everyone else lost",
      bidOutcome({ userId: "b", status: "ended", winnerId: "a", topBidderId: "a" }),
      "lost",
    );
    eq(
      "a cancelled auction produced no winner, so nobody won it",
      bidOutcome({ userId: "a", status: "cancelled", winnerId: null, topBidderId: "a" }),
      "lost",
    );
  }

  console.log("\nNOBODY, AND SOMEBODY WHO DOES NOT EXIST");
  {
    const missing = await memberDetail(`no-such-user-${randomUUID()}`);
    eq("an id that belongs to nobody is null, not a throw", missing, null);

    const fresh = await person("เพิ่งสมัคร");
    const detail = await memberDetail(fresh.id);
    check("an account with no history still has a page", detail !== null);
    eq("  with no role yet", detail?.role, "none");
    eq("  no phone", detail?.phones.length, 0);
    eq("  no identity submission", detail?.kyc, null);
    eq("  no bids", detail?.bids.total, 0);
    eq("  no purchases", detail?.purchases.total, 0);
    eq("  no listings", detail?.listings.total, 0);
    eq("  no sales", detail?.sales.total, 0);
    eq("  no strikes", detail?.strikes.total, 0);
    eq("  no bans", detail?.bans.length, 0);
    eq("  nobody invited them", detail?.referredBy, null);
    eq("  and they invited nobody", detail?.invited.total, 0);
  }

  console.log("\nEVERY SECTION IS ABOUT THE RIGHT PERSON");
  const category = await testCategory();
  const subject = await person("คนที่ดูอยู่");
  const other = await person("อีกคนหนึ่ง");
  const seller = await person("ผู้ขายกลาง");
  {
    // A bid each, on two different items, so a section that forgot its WHERE
    // would show the other one.
    const mine = await listing(seller.id, category.id, { title: `ของฉัน ${RUN}` });
    const theirs = await listing(seller.id, category.id, { title: `ของเขา ${RUN}` });
    await bid(mine.id, subject.id, 120_000);
    await bid(theirs.id, other.id, 130_000);

    const detail = (await memberDetail(subject.id))!;
    eq("one bid, not two", detail.bids.total, 1);
    eq("  and it is theirs", detail.bids.rows[0]?.itemTitle, `ของฉัน ${RUN}`);
    eq("  leading, because nobody has outbid them", detail.bids.rows[0]?.outcome, "leading");
    eq("  bidding makes them a buyer", detail.role, "buyer");
    eq(
      "  which is the same rule the member list uses",
      detail.role,
      memberRole({ hasBid: true, approvedSeller: false }),
    );

    // A purchase each.
    const bought = await listing(seller.id, category.id, {
      title: `ที่ซื้อ ${RUN}`,
      status: "ended",
      winnerId: subject.id,
    });
    await prisma.auctionItem.update({
      where: { id: bought.id },
      data: { shippingStatus: "shipped", trackingNumber: `TH${RUN}` },
    });
    // The bid that won it, so the outcome has something to be read off.
    await bid(bought.id, subject.id, 250_000);
    await payment(bought.id, subject.id, { amount: 250_000 });

    const theirBuy = await listing(seller.id, category.id, {
      status: "ended",
      winnerId: other.id,
    });
    await payment(theirBuy.id, other.id, { amount: 999_000 });

    const withPurchase = (await memberDetail(subject.id))!;
    eq("one purchase, not the other person's", withPurchase.purchases.total, 1);
    eq("  the right item", withPurchase.purchases.rows[0]?.itemTitle, `ที่ซื้อ ${RUN}`);
    eq("  the right amount", withPurchase.purchases.rows[0]?.amount, 250_000);
    eq("  the parcel's state comes with it", withPurchase.purchases.rows[0]?.shippingStatus, "shipped");
    eq("  and its tracking number", withPurchase.purchases.rows[0]?.trackingNumber, `TH${RUN}`);
    eq(
      "  and the bid that won it reads as won",
      withPurchase.bids.rows.find((b) => b.itemTitle === `ที่ซื้อ ${RUN}`)?.outcome,
      "won",
    );
    eq("  which is a second bid for them", withPurchase.bids.total, 2);
  }

  console.log("\nSELLING");
  {
    const sellerAccount = await person("ผู้ขายที่ดูอยู่");
    const buyer = await person("ผู้ซื้อของเขา");
    const listed = await listing(sellerAccount.id, category.id, {
      title: `ที่ลงขาย ${RUN}`,
      status: "ended",
      winnerId: buyer.id,
      price: 300_000,
    });
    await payment(listed.id, buyer.id, { amount: 300_000, payoutStatus: "pending" });
    // An unsettled charge on the same item must not read as a sale.
    const unsoldItem = await listing(sellerAccount.id, category.id, {
      title: `ยังไม่ขาย ${RUN}`,
    });
    await payment(unsoldItem.id, buyer.id, { status: "expired", paid: false });

    const detail = (await memberDetail(sellerAccount.id))!;
    eq("both listings are theirs", detail.listings.total, 2);
    eq("only the settled one is a sale", detail.sales.total, 1);
    eq("  for the amount that settled", detail.sales.rows[0]?.amount, 300_000);
    eq("  with what the seller is owed", detail.sales.rows[0]?.sellerNet, 280_000);
    eq("  and its payout still pending", detail.sales.rows[0]?.payoutStatus, "pending");

    // The buyer's page must show the same payment as a PURCHASE, not a sale.
    const buyerSide = (await memberDetail(buyer.id))!;
    eq("the buyer sees it as a purchase", buyerSide.purchases.total, 2);
    eq("  and has sold nothing", buyerSide.sales.total, 0);
    eq("  and listed nothing", buyerSide.listings.total, 0);
  }

  console.log("\nSTRIKES AND BANS");
  {
    const scolded = await person("ผู้ไม่ชำระ");
    const admin = await person("แอดมิน");
    const item = await listing(seller.id, category.id, { title: `ไม่จ่าย ${RUN}` });
    await prisma.paymentStrike.create({
      data: { userId: scolded.id, auctionItemId: item.id, amount: 150_000 },
    });
    // Somebody else's strike, on the same item.
    const alsoScolded = await person("อีกคนที่ไม่ชำระ");
    const item2 = await listing(seller.id, category.id);
    await prisma.paymentStrike.create({
      data: { userId: alsoScolded.id, auctionItemId: item2.id, amount: 111_000 },
    });

    await prisma.userBan.create({
      data: {
        userId: scolded.id,
        kind: "bidding",
        reason: "ไม่ชำระเงินสามครั้ง",
        bannedById: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.userBan.create({
      data: {
        userId: scolded.id,
        kind: "login",
        reason: "ยกเลิกไปแล้ว",
        bannedById: admin.id,
        liftedAt: new Date(),
      },
    });

    const detail = (await memberDetail(scolded.id))!;
    eq("their strike, not the other account's", detail.strikes.total, 1);
    eq("  on the right item", detail.strikes.rows[0]?.itemTitle, `ไม่จ่าย ${RUN}`);
    eq("  for the right amount", detail.strikes.rows[0]?.amount, 150_000);

    eq("the whole ban history is there", detail.bans.length, 2);
    eq("  but only the live one counts as in force", detail.activeBans.length, 1);
    eq("    and it is the bidding ban", detail.activeBans[0]?.kind, "bidding");

    const clean = (await memberDetail(admin.id))!;
    eq("the admin who issued them has none of their own", clean.bans.length, 0);
    eq("  and no strikes", clean.strikes.total, 0);
  }

  console.log("\nWHO INVITED WHOM");
  {
    const inviter = await person("ผู้ชวน");
    const invitee = await person("ผู้ถูกชวน");
    const bystander = await person("คนนอก");
    const code = await ensureReferralCode(inviter.id);
    await recordSignupReferral({ referredUserId: invitee.id, code });
    await markReferralVerified(invitee.id);

    const secondInvitee = await person("ผู้ถูกชวนคนที่สอง");
    await recordSignupReferral({ referredUserId: secondInvitee.id, code });

    const inviterSide = (await memberDetail(inviter.id))!;
    eq("the inviter's two invitees are listed", inviterSide.invited.total, 2);
    eq("  newest first", inviterSide.invited.rows[0]?.name, secondInvitee.name);
    eq("  with the verified one's state", 
      inviterSide.invited.rows.find((r) => r.userId === invitee.id)?.status, "verified");
    eq("  each linkable by account id", inviterSide.invited.rows[0]?.userId, secondInvitee.id);
    eq("  and nobody invited the inviter", inviterSide.referredBy, null);

    const inviteeSide = (await memberDetail(invitee.id))!;
    eq("the invitee knows who brought them", inviteeSide.referredBy?.id, inviter.id);
    eq("  under the code that was used", inviteeSide.referredBy?.code, code);
    eq("  and has invited nobody", inviteeSide.invited.total, 0);

    const bystanderSide = (await memberDetail(bystander.id))!;
    eq("someone uninvolved has neither side", bystanderSide.referredBy, null);
    eq("  nor any invitees", bystanderSide.invited.total, 0);
  }

  console.log("\nA LONG HISTORY IS CAPPED, AND SAYS SO");
  {
    const busy = await person("คนที่บิดเยอะ");
    const item = await listing(seller.id, category.id, { title: `ของยอดฮิต ${RUN}` });
    for (let i = 0; i < SECTION_LIMIT + 3; i++) {
      await bid(item.id, busy.id, 200_000 + i * 1_000);
    }

    const detail = (await memberDetail(busy.id))!;
    eq("the list stops at the limit", detail.bids.rows.length, SECTION_LIMIT);
    eq("  but the total is the real one", detail.bids.total, SECTION_LIMIT + 3);
    check(
      "  and the newest are the ones kept",
      detail.bids.rows[0]!.amount > detail.bids.rows[SECTION_LIMIT - 1]!.amount,
      `${detail.bids.rows[0]?.amount} vs ${detail.bids.rows[SECTION_LIMIT - 1]?.amount}`,
    );
  }

  console.log("\nNOTHING SENSITIVE IS ON THE PAGE");
  {
    const detail = (await memberDetail(subject.id))!;
    const keys = Object.keys(detail).sort().join(",");
    check(
      "no bank account, no identity document, no card",
      !/bank|kycKey|idCard|account(Number|Name)|card/i.test(keys),
      keys,
    );
    // The identity STATE is on the page; the photograph is not, and neither is
    // the storage key that would fetch it.
    check("the identity status is there, as a word", detail.kyc === null || typeof detail.kyc === "string");
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

  console.log(failures === 0 ? "\nmember detail holds" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[member-detail.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
