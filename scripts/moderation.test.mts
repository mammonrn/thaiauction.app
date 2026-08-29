/**
 * Reporting listings, removing them, and admin-issued bans.
 *
 * Database only — no gateway, no network.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/moderation.test.mts
 *
 * `.mts` for top-level await; `--conditions=react-server` because the modules
 * under test import "server-only".
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  deleteItem,
  dismissReports,
  reportItem,
  reportedItems,
} from "../lib/moderation";
import {
  activeBan,
  banExpiry,
  banHistory,
  biddingBan,
  issueBan,
  liftBan,
  loginBan,
} from "../lib/bans";
import { endAuctionBySeller, placeBid } from "../lib/bidding";
import { countStrikes, STRIKE_LIMIT } from "../lib/strikes";

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
    where: { OR: [{ auctionItemId: { in: itemIds } }, { reporterId: { in: ids } }, { reviewedById: { in: ids } }] },
  });
  await prisma.userBan.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
  });
  // deletedById is Restrict: clear it before the admin fixture is removed.
  await prisma.auctionItem.updateMany({
    where: { deletedById: { in: ids } },
    data: { deletedById: null },
  });
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

async function auction(
  sellerId: string,
  options: { status?: "draft" | "active" | "ended"; paymentState?: string; winnerId?: string } = {},
) {
  const category = await prisma.category.upsert({
    where: { slug: "amulets" },
    update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  return prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: category.id,
      title: `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: 100_000,
      currentPrice: 100_000,
      bidIncrement: 1_000,
      status: options.status ?? "active",
      ...(options.winnerId
        ? {
            winnerId: options.winnerId,
            endedAt: new Date(),
            endReason: "expired" as const,
          }
        : {}),
      ...(options.paymentState
        ? { paymentState: options.paymentState as "awaiting_payment" }
        : {}),
    },
  });
}

await resetFixtures();

console.log("\nREPORTING A LISTING");
{
  const seller = await user("s");
  const reporter = await user("r");
  const item = await auction(seller.id);

  const result = await reportItem({
    itemId: item.id,
    reporterId: reporter.id,
    reason: "counterfeit",
  });
  check("a signed-in stranger can report", result.ok, JSON.stringify(result));
  eq("and it is their first", result.ok && result.alreadyReported, false);
  eq("one report exists",
    await prisma.itemReport.count({ where: { auctionItemId: item.id } }), 1);
  eq("open, awaiting an admin",
    (await prisma.itemReport.findFirstOrThrow({ where: { auctionItemId: item.id } })).status,
    "open");
}

console.log("\nWHO MAY NOT REPORT");
{
  const seller = await user("s");
  const item = await auction(seller.id);

  eq("the seller cannot report their own listing",
    ((await reportItem({ itemId: item.id, reporterId: seller.id, reason: "illegal" })) as { reason?: string }).reason,
    "own_item");
  eq("nothing was recorded",
    await prisma.itemReport.count({ where: { auctionItemId: item.id } }), 0);

  const reporter = await user("r");
  eq("an unknown listing is not_found",
    ((await reportItem({ itemId: randomUUID(), reporterId: reporter.id, reason: "illegal" })) as { reason?: string }).reason,
    "not_found");

  const draft = await auction(seller.id, { status: "draft" });
  eq("a draft cannot be reported — it is not public",
    ((await reportItem({ itemId: draft.id, reporterId: reporter.id, reason: "illegal" })) as { reason?: string }).reason,
    "not_found");

  eq("a made-up reason is refused",
    ((await reportItem({ itemId: item.id, reporterId: reporter.id, reason: "because" })) as { reason?: string }).reason,
    "invalid_reason");

  eq("an overlong note is refused",
    ((await reportItem({
      itemId: item.id, reporterId: reporter.id, reason: "other",
      note: "x".repeat(501),
    })) as { reason?: string }).reason,
    "note_too_long");
}
{
  // Signing out is enforced at the action layer, which requires a session
  // before it ever reaches here. What lib/moderation guarantees is that a
  // report is always attributed to a real account.
  const seller = await user("s");
  const item = await auction(seller.id);
  let threw = false;
  try {
    await reportItem({ itemId: item.id, reporterId: randomUUID(), reason: "illegal" });
  } catch {
    threw = true;
  }
  check("a report from an account that does not exist cannot be stored", threw);
}

console.log("\nREPORTING TWICE");
{
  const seller = await user("s");
  const reporter = await user("r");
  const other = await user("r2");
  const item = await auction(seller.id);

  await reportItem({ itemId: item.id, reporterId: reporter.id, reason: "illegal" });
  const second = await reportItem({
    itemId: item.id, reporterId: reporter.id, reason: "counterfeit",
  });
  check("the same person reporting again is accepted", second.ok);
  eq("and told it was already theirs", second.ok && second.alreadyReported, true);
  eq("but it is still ONE report — the count means people, not clicks",
    await prisma.itemReport.count({ where: { auctionItemId: item.id } }), 1);
  eq("with the newer reason",
    (await prisma.itemReport.findFirstOrThrow({ where: { auctionItemId: item.id } })).reason,
    "counterfeit");

  await reportItem({ itemId: item.id, reporterId: other.id, reason: "illegal" });
  eq("a different person makes it two",
    await prisma.itemReport.count({ where: { auctionItemId: item.id } }), 2);

  const queue = await reportedItems();
  const entry = queue.find((row) => row.item.id === item.id);
  eq("and the admin queue counts two", entry?.reportCount, 2);
}
{
  // A dismissed report that is re-filed comes back: the reporter is saying it
  // is still wrong, and it should be looked at again rather than stay closed.
  const seller = await user("s");
  const reporter = await user("r");
  const admin = await user("a");
  const item = await auction(seller.id);

  await reportItem({ itemId: item.id, reporterId: reporter.id, reason: "illegal" });
  await dismissReports(item.id, admin.id);
  eq("dismissing closes it",
    (await prisma.itemReport.findFirstOrThrow({ where: { auctionItemId: item.id } })).status,
    "dismissed");
  eq("so it leaves the queue",
    (await reportedItems()).find((row) => row.item.id === item.id), undefined);

  await reportItem({ itemId: item.id, reporterId: reporter.id, reason: "illegal" });
  eq("re-reporting reopens it",
    (await prisma.itemReport.findFirstOrThrow({ where: { auctionItemId: item.id } })).status,
    "open");
}

console.log("\nREMOVING A LISTING");
{
  const seller = await user("s");
  const reporter = await user("r");
  const admin = await user("a");
  const item = await auction(seller.id);
  await reportItem({ itemId: item.id, reporterId: reporter.id, reason: "illegal" });

  const result = await deleteItem({ itemId: item.id, adminId: admin.id, reason: "ของผิดกฎหมาย" });
  check("an admin can remove it", result.ok, JSON.stringify(result));

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  check("it is soft-deleted, not erased", after.deletedAt !== null);
  eq("with the admin recorded", after.deletedById, admin.id);
  eq("and the reason", after.deletedReason, "ของผิดกฎหมาย");
  eq("the row still exists",
    await prisma.auctionItem.count({ where: { id: item.id } }), 1);
  eq("its open reports are marked actioned",
    (await prisma.itemReport.findFirstOrThrow({ where: { auctionItemId: item.id } })).status,
    "actioned");

  eq("removing it twice is refused",
    ((await deleteItem({ itemId: item.id, adminId: admin.id, reason: "x" })) as { reason?: string }).reason,
    "already_deleted");
  eq("a blank reason is refused",
    ((await deleteItem({ itemId: randomUUID(), adminId: admin.id, reason: "  " })) as { reason?: string }).reason,
    "no_reason");
}

console.log("\nA LISTING SOMEONE STILL OWES FOR");
{
  const seller = await user("s");
  const winner = await user("w");
  const admin = await user("a");
  const item = await auction(seller.id, {
    status: "ended",
    winnerId: winner.id,
    paymentState: "awaiting_payment",
  });

  const refused = await deleteItem({ itemId: item.id, adminId: admin.id, reason: "ผิดกฎ" });
  eq("cannot be removed while payment is owed",
    (refused as { reason?: string }).reason, "awaiting_payment");
  eq("and it is still visible",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt,
    null);

  // The way through is to settle the obligation first, using the auction's own
  // mechanism — nothing in lib/moderation reaches around it.
  await prisma.auctionItem.update({
    where: { id: item.id },
    data: { paymentState: "unpaid", winnerId: null, paymentDueAt: null },
  });
  const now = await deleteItem({ itemId: item.id, adminId: admin.id, reason: "ผิดกฎ" });
  check("once nothing is owed, it can be removed", now.ok, JSON.stringify(now));
}

console.log("\nA REMOVED LISTING IS GONE FROM THE PUBLIC SIDE");
{
  const seller = await user("s");
  const admin = await user("a");
  const item = await auction(seller.id);
  await deleteItem({ itemId: item.id, adminId: admin.id, reason: "ผิดกฎ" });

  eq("the public item query finds nothing",
    await prisma.auctionItem.count({
      where: { id: item.id, deletedAt: null, status: { in: ["active", "ended", "cancelled"] } },
    }),
    0);
  eq("but an admin can still read it",
    await prisma.auctionItem.count({ where: { id: item.id } }), 1);
  eq("and it can no longer be reported",
    ((await reportItem({ itemId: item.id, reporterId: (await user("r")).id, reason: "illegal" })) as { reason?: string }).reason,
    "not_found");
}

console.log("\nBANS — SEPARATE FROM STRIKES");
{
  const admin = await user("a");
  const target = await user("t");

  const before = await countStrikes(target.id);
  const result = await issueBan({
    userId: target.id, kind: "bidding", reason: "ประมูลปั่นราคา",
    duration: 7, bannedById: admin.id,
  });
  check("a ban is issued", result.ok, JSON.stringify(result));

  eq("and it adds NO strike — the two systems are separate",
    await countStrikes(target.id), before);
  eq("no strike row was written",
    await prisma.paymentStrike.count({ where: { userId: target.id } }), 0);

  const ban = await biddingBan(target.id);
  check("the bidding ban is in force", ban !== null);
  eq("with the reason", ban?.reason, "ประมูลปั่นราคา");
  check("and an expiry seven days out",
    ban?.expiresAt !== null &&
      Math.abs(ban!.expiresAt!.getTime() - Date.now() - 7 * 86_400_000) < 5_000,
    String(ban?.expiresAt));

  eq("a bidding ban does not block login", await loginBan(target.id), null);
}
{
  const admin = await user("a");
  const target = await user("t");
  await issueBan({
    userId: target.id, kind: "login", reason: "สแปม", duration: 1, bannedById: admin.id,
  });
  check("a login ban is in force", (await loginBan(target.id)) !== null);
  check("and it also stops bidding — you cannot bid if you cannot sign in",
    (await biddingBan(target.id)) !== null);
}

console.log("\nBANS EXPIRE BY THEMSELVES");
{
  const admin = await user("a");
  const target = await user("t");
  const ban = await issueBan({
    userId: target.id, kind: "login", reason: "หมดอายุแล้ว", duration: 1, bannedById: admin.id,
  });
  check("in force to begin with", (await loginBan(target.id)) !== null);

  // Move its expiry into the past — the same thing time does on its own.
  await prisma.userBan.update({
    where: { id: (ban as { banId: string }).banId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });

  eq("an expired login ban stops applying, with nothing run to lift it",
    await loginBan(target.id), null);
  eq("and bidding is free again", await biddingBan(target.id), null);
  eq("but the row is still there for the history",
    await prisma.userBan.count({ where: { userId: target.id } }), 1);
}
{
  const admin = await user("a");
  const target = await user("t");
  await issueBan({
    userId: target.id, kind: "bidding", reason: "ถาวร", duration: "permanent", bannedById: admin.id,
  });
  const ban = await biddingBan(target.id);
  check("a permanent ban has no expiry", ban !== null && ban.expiresAt === null);
  eq("banExpiry says so too", banExpiry("permanent", new Date()), null);
}

console.log("\nSTACKING AND LIFTING");
{
  const admin = await user("a");
  const target = await user("t");
  await issueBan({
    userId: target.id, kind: "bidding", reason: "ยาว", duration: 30, bannedById: admin.id,
  });
  await issueBan({
    userId: target.id, kind: "bidding", reason: "สั้น", duration: 1, bannedById: admin.id,
  });
  const ban = await biddingBan(target.id);
  eq("a shorter ban laid on top cannot shorten a longer one", ban?.reason, "ยาว");

  const lift = await liftBan(ban!.id);
  check("lifting the long one succeeds", lift.ok);
  eq("the short one is still in force", (await biddingBan(target.id))?.reason, "สั้น");
  eq("lifting the same ban twice is refused",
    ((await liftBan(ban!.id)) as { reason?: string }).reason, "not_found");
  eq("and the lifted row survives for the record",
    await prisma.userBan.count({ where: { userId: target.id } }), 2);
}

console.log("\nWHAT A BAN REFUSES");
{
  const admin = await user("a");
  eq("a ban with no reason is refused",
    ((await issueBan({ userId: admin.id, kind: "login", reason: "  ", duration: 1, bannedById: admin.id })) as { reason?: string }).reason,
    "no_reason");
  eq("an admin cannot ban themselves",
    ((await issueBan({ userId: admin.id, kind: "login", reason: "ทดสอบ", duration: 1, bannedById: admin.id })) as { reason?: string }).reason,
    "self");
  eq("an unknown account is refused",
    ((await issueBan({ userId: randomUUID(), kind: "login", reason: "ทดสอบ", duration: 1, bannedById: admin.id })) as { reason?: string }).reason,
    "not_found");
}

console.log("\nTHE BAN HISTORY AN ADMIN READS");
{
  const admin = await user("a");
  const target = await user("t");
  await issueBan({
    userId: target.id, kind: "login", reason: "ครั้งแรก", duration: 1, bannedById: admin.id,
  });
  await issueBan({
    userId: target.id, kind: "bidding", reason: "ครั้งที่สอง", duration: 3, bannedById: admin.id,
  });

  const history = await banHistory(target.id);
  eq("every ban is listed", history.length, 2);
  eq("newest first", history[0].reason, "ครั้งที่สอง");
  eq("with who issued it", history[0].bannedBy.email, admin.email);
  check("when it was issued", history[0].createdAt instanceof Date);
  check("and when it expires", history[0].expiresAt !== null);
}

console.log("\nSTRIKES ARE UNTOUCHED");
{
  // A banned account's strike count is still driven only by unpaid deadlines,
  // and a struck account's ban list is still empty.
  const admin = await user("a");
  const target = await user("t");
  const seller = await user("s");

  for (let i = 0; i < STRIKE_LIMIT; i++) {
    const past = await auction(seller.id);
    await prisma.paymentStrike.create({
      data: { userId: target.id, auctionItemId: past.id, amount: 100_000 },
    });
  }
  eq("strikes still count as before", await countStrikes(target.id), STRIKE_LIMIT);
  eq("and being struck creates no ban row",
    await prisma.userBan.count({ where: { userId: target.id } }), 0);

  await issueBan({
    userId: target.id, kind: "bidding", reason: "แยกกัน", duration: 1, bannedById: admin.id,
  });
  eq("issuing a ban does not change the strike count",
    await countStrikes(target.id), STRIKE_LIMIT);

  // And the strike path still refuses the bid on its own terms.
  const item = await auction(seller.id);
  const bid = await placeBid(item.id, target.id, 101_000);
  eq("lib/bidding still refuses a struck bidder as 'banned' (its own word)",
    (bid as { reason?: string }).reason, "banned");
  eq("reporting the strike count, not the admin ban",
    (bid as { strikes?: number }).strikes, STRIKE_LIMIT);
}
{
  // An admin ban alone does NOT make lib/bidding refuse: that check lives in
  // the action layer, and lib/bidding.ts is deliberately unchanged.
  const admin = await user("a");
  const bidder = await user("b");
  const seller = await user("s");
  const item = await auction(seller.id);
  await issueBan({
    userId: bidder.id, kind: "bidding", reason: "แบน", duration: 1, bannedById: admin.id,
  });

  const bid = await placeBid(item.id, bidder.id, 101_000);
  check("lib/bidding itself knows nothing about admin bans", bid.ok, JSON.stringify(bid));
  check("which is why the action layer checks biddingBan before calling it",
    (await biddingBan(bidder.id)) !== null);

  await endAuctionBySeller(item.id, seller.id);
}

console.log("\nACTIVE BAN BY KIND");
{
  const admin = await user("a");
  const target = await user("t");
  await issueBan({
    userId: target.id, kind: "bidding", reason: "เฉพาะบิด", duration: 1, bannedById: admin.id,
  });
  check("the bidding kind is found", (await activeBan(target.id, "bidding")) !== null);
  eq("the login kind is not", await activeBan(target.id, "login"), null);
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nmoderation holds" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
