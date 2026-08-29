/**
 * In-app notifications: who gets what, deduplication, and isolation.
 *
 * Database only — VAPID is unset here, so lib/push short-circuits and no push
 * is attempted. That is itself part of what this proves: the bell works with
 * Web Push entirely unconfigured.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/notifications.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  listNotifications,
  markAllRead,
  markRead,
  notifyBidPlaced,
  notifyBuyNow,
  notifyPaymentMissed,
  notifyPaymentReceived,
  remindEndingSoon,
  syncAuctionNotifications,
  syncMissedPaymentNotifications,
  unreadNotificationCount,
  NOTIFICATIONS_PER_PAGE,
} from "../lib/notifications";
import { endAuctionBySeller, placeBid } from "../lib/bidding";

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
  await prisma.auctionItem.updateMany({ where: { deletedById: { in: ids } }, data: { deletedById: null } });
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
  options: { endTime?: Date | null; buyNowPrice?: number | null } = {},
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
      buyNowPrice: options.buyNowPrice === undefined ? 150_000 : options.buyNowPrice,
      endTime: options.endTime ?? null,
      status: "active",
    },
  });
}

/** Every notification of one type addressed to one person. */
async function notesFor(userId: string, type?: string) {
  return prisma.notification.findMany({
    where: { userId, ...(type ? { type: type as "new_bid" } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

await resetFixtures();

console.log("\nA BID REACHES THE SELLER, NOT THE BIDDER");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: bidder.id, amount: 101_000, previousLeaderId: null,
  });

  const forSeller = await notesFor(seller.id);
  eq("the seller is told once", forSeller.length, 1);
  eq("as a new_bid", forSeller[0].type, "new_bid");
  check("naming the item", forSeller[0].body.includes(item.title), forSeller[0].body);
  check("and the amount", forSeller[0].body.includes("1,010"), forSeller[0].body);
  eq("linking to the listing", forSeller[0].url, `/auctions/${item.id}`);
  eq("unread to begin with", forSeller[0].readAt, null);

  eq("the bidder hears nothing about their own bid", (await notesFor(bidder.id)).length, 0);
}
{
  // A seller bidding on their own item cannot happen through placeBid, but the
  // notification layer must not rely on that.
  const seller = await user("s");
  const item = await auction(seller.id);
  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: seller.id, amount: 101_000, previousLeaderId: null,
  });
  eq("nobody is told when the seller is the bidder", (await notesFor(seller.id)).length, 0);
}

console.log("\nBEING OUTBID");
{
  const seller = await user("s");
  const first = await user("b1");
  const second = await user("b2");
  const item = await auction(seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: second.id, amount: 102_000, previousLeaderId: first.id,
  });

  const outbid = await notesFor(first.id, "outbid");
  eq("the person who just lost the lead is told", outbid.length, 1);
  check("with the new price", outbid[0].body.includes("1,020"), outbid[0].body);
  eq("the new leader is not told they outbid themselves",
    (await notesFor(second.id)).length, 0);
}
{
  // Only the leader, not everyone who ever bid: a third bidder who was already
  // behind hears nothing new.
  const seller = await user("s");
  const behind = await user("b0");
  const leader = await user("b1");
  const newest = await user("b2");
  const item = await auction(seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: newest.id, amount: 103_000, previousLeaderId: leader.id,
  });
  eq("someone already behind is not told again", (await notesFor(behind.id)).length, 0);
  eq("only the displaced leader is", (await notesFor(leader.id, "outbid")).length, 1);
}

console.log("\nTWENTY RAPID BIDS ARE ONE LINE");
{
  const seller = await user("s");
  const bidders = [await user("b1"), await user("b2")];
  const item = await auction(seller.id);

  for (let i = 1; i <= 20; i++) {
    await notifyBidPlaced({
      itemId: item.id, itemTitle: item.title, sellerId: seller.id,
      bidderId: bidders[i % 2].id, amount: 100_000 + i * 1_000,
      previousLeaderId: bidders[(i + 1) % 2].id,
    });
  }

  const sellerNotes = await notesFor(seller.id, "new_bid");
  eq("the seller has ONE new_bid, not twenty", sellerNotes.length, 1);
  check("showing the latest price", sellerNotes[0].body.includes("1,200"), sellerNotes[0].body);

  eq("each bidder has one outbid line", (await notesFor(bidders[0].id, "outbid")).length, 1);
  eq("and so does the other", (await notesFor(bidders[1].id, "outbid")).length, 1);
}
{
  // Reading it ends the collapse: the next bid is genuinely new news.
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: bidder.id, amount: 101_000, previousLeaderId: null,
  });
  const first = (await notesFor(seller.id, "new_bid"))[0];
  await markRead(first.id, seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: bidder.id, amount: 102_000, previousLeaderId: null,
  });
  eq("a bid after the last was read makes a new line",
    (await notesFor(seller.id, "new_bid")).length, 2);
}

console.log("\nBUYING OUTRIGHT");
{
  const seller = await user("s");
  const buyer = await user("b");
  const loser = await user("l");
  const item = await auction(seller.id);

  await notifyBuyNow({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    buyerId: buyer.id, amount: 150_000, previousLeaderId: loser.id,
  });

  eq("the seller is told it sold", (await notesFor(seller.id, "buy_now")).length, 1);

  const won = await notesFor(buyer.id, "auction_won");
  eq("the buyer is told they won", won.length, 1);
  eq("pointing straight at the pay page", won[0].url, `/auctions/${item.id}/pay`);
  check("and naming the deadline", won[0].body.includes("24 ชั่วโมง"), won[0].body);

  eq("whoever was leading is told it is gone", (await notesFor(loser.id, "outbid")).length, 1);
  eq("the buyer is not told they outbid themselves",
    (await notesFor(buyer.id, "outbid")).length, 0);
}

console.log("\nMONEY");
{
  const seller = await user("s");
  const item = await auction(seller.id);

  await notifyPaymentReceived({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id, amount: 150_000,
  });
  const paid = await notesFor(seller.id, "payment_received");
  eq("the seller is told the money landed", paid.length, 1);
  eq("and sent where they can post it", paid[0].url, "/sell");

  // Both the buyer's poll and the settle sweep can see the same payment.
  await notifyPaymentReceived({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id, amount: 150_000,
  });
  eq("two code paths seeing one payment still say it once",
    (await notesFor(seller.id, "payment_received")).length, 1);
}
{
  const seller = await user("s");
  const item = await auction(seller.id);
  await notifyPaymentMissed({ itemId: item.id, itemTitle: item.title, sellerId: seller.id });
  await notifyPaymentMissed({ itemId: item.id, itemTitle: item.title, sellerId: seller.id });
  eq("a missed deadline is announced once", (await notesFor(seller.id, "payment_missed")).length, 1);
}

console.log("\nENDING SOON");
{
  const seller = await user("s");
  const bidder = await user("b");
  const other = await user("c");
  const soon = await auction(seller.id, {
    endTime: new Date(Date.now() + 10 * 60_000), buyNowPrice: null,
  });
  await placeBid(soon.id, bidder.id, 101_000);
  await placeBid(soon.id, other.id, 102_000);

  const sent = await remindEndingSoon();
  check("the sweep reminds the bidders", sent >= 2, String(sent));
  eq("each bidder once", (await notesFor(bidder.id, "ending_soon")).length, 1);
  eq("and the other too", (await notesFor(other.id, "ending_soon")).length, 1);
  eq("the seller is not reminded about their own clock",
    (await notesFor(seller.id, "ending_soon")).length, 0);

  const again = await remindEndingSoon();
  eq("running the sweep twice sends nothing more", again, 0);
  eq("and still one each", (await notesFor(bidder.id, "ending_soon")).length, 1);

  // Even after it is read: an auction ends once.
  const note = (await notesFor(bidder.id, "ending_soon"))[0];
  await markRead(note.id, bidder.id);
  await remindEndingSoon();
  eq("reading it does not let the reminder come back",
    (await notesFor(bidder.id, "ending_soon")).length, 1);
}
{
  const seller = await user("s");
  const bidder = await user("b");
  const far = await auction(seller.id, {
    endTime: new Date(Date.now() + 6 * 60 * 60_000), buyNowPrice: null,
  });
  await placeBid(far.id, bidder.id, 101_000);
  await remindEndingSoon();
  eq("an auction hours away is not called ending soon",
    (await notesFor(bidder.id, "ending_soon")).length, 0);
}

console.log("\nCATCHING UP AFTER A CLOSE");
{
  const seller = await user("s");
  const winner = await user("w");
  const item = await auction(seller.id, { endTime: null, buyNowPrice: null });
  await placeBid(item.id, winner.id, 101_000);
  await endAuctionBySeller(item.id, seller.id);

  await syncAuctionNotifications(item.id);
  eq("the winner of an ordinary auction is told",
    (await notesFor(winner.id, "auction_won")).length, 1);

  await syncAuctionNotifications(item.id);
  await syncAuctionNotifications();
  eq("however many times the sweep runs",
    (await notesFor(winner.id, "auction_won")).length, 1);

  await prisma.auctionItem.update({
    where: { id: item.id },
    data: { paymentState: "paid" },
  });
  await syncAuctionNotifications(item.id);
  eq("and the seller hears the money landed",
    (await notesFor(seller.id, "payment_received")).length, 1);
}
{
  const seller = await user("s");
  const loser = await user("w");
  const item = await auction(seller.id, { buyNowPrice: null });
  await prisma.paymentStrike.create({
    data: { userId: loser.id, auctionItemId: item.id, amount: 101_000 },
  });

  await syncMissedPaymentNotifications();
  await syncMissedPaymentNotifications();
  eq("a strike tells the seller once",
    (await notesFor(seller.id, "payment_missed")).length, 1);
}

console.log("\nNOBODY READS ANYBODY ELSE'S");
{
  const mine = await user("m");
  const yours = await user("y");
  const seller = await user("s");
  const item = await auction(seller.id);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: mine.id,
    bidderId: seller.id, amount: 101_000, previousLeaderId: null,
  });
  const note = (await notesFor(mine.id))[0];

  const stolen = await listNotifications(yours.id);
  eq("a stranger's list does not contain it", stolen.items.length, 0);
  eq("nor does their unread count", await unreadNotificationCount(yours.id), 0);

  check("and they cannot mark it read", (await markRead(note.id, yours.id)) === false);
  eq("so it is still unread",
    (await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).readAt,
    null);

  check("but the owner can", (await markRead(note.id, mine.id)) === true);
  check("marking an already-read one again does nothing",
    (await markRead(note.id, mine.id)) === false);
}

console.log("\nCOUNTING AND CLEARING");
{
  const person = await user("p");
  const seller = await user("s");
  const item = await auction(seller.id);

  eq("nothing unread to start", await unreadNotificationCount(person.id), 0);

  for (let i = 0; i < 3; i++) {
    const other = await auction(seller.id);
    await notifyBidPlaced({
      itemId: other.id, itemTitle: other.title, sellerId: person.id,
      bidderId: seller.id, amount: 101_000, previousLeaderId: null,
    });
  }
  eq("three unread", await unreadNotificationCount(person.id), 3);

  eq("read-all clears them", await markAllRead(person.id), 3);
  eq("and the badge is empty", await unreadNotificationCount(person.id), 0);
  eq("read-all again clears nothing", await markAllRead(person.id), 0);

  // The rows survive; only the badge changes.
  eq("the list still shows them", (await listNotifications(person.id)).items.length, 3);
  void item;
}

console.log("\nPAGING, AND THE 90-DAY HORIZON");
{
  const person = await user("p");
  const seller = await user("s");

  for (let i = 0; i < NOTIFICATIONS_PER_PAGE + 5; i++) {
    const item = await auction(seller.id);
    await notifyBidPlaced({
      itemId: item.id, itemTitle: item.title, sellerId: person.id,
      bidderId: seller.id, amount: 101_000, previousLeaderId: null,
    });
  }

  const first = await listNotifications(person.id, 1);
  eq("a page is capped", first.items.length, NOTIFICATIONS_PER_PAGE);
  check("and says there is more", first.hasMore);

  const second = await listNotifications(person.id, 2);
  eq("the rest are on page two", second.items.length, 5);
  check("which is the last", second.hasMore === false);

  const ids = new Set([...first.items, ...second.items].map((n) => n.id));
  eq("no row appears on both pages", ids.size, NOTIFICATIONS_PER_PAGE + 5);

  check("newest first",
    first.items[0].createdAt.getTime() >= first.items[1].createdAt.getTime());

  // Age one out.
  await prisma.notification.update({
    where: { id: second.items[4].id },
    data: { createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
  });
  const aged = await listNotifications(person.id, 2);
  eq("anything older than 90 days is not shown", aged.items.length, 4);
}

console.log("\nA BROKEN BELL DOES NOT BREAK A BID");
{
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, { buyNowPrice: null });

  // Make writing a notification fail for real, by pointing it at an account
  // that does not exist: the foreign key refuses the insert.
  const ghost = randomUUID();
  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: ghost,
    bidderId: bidder.id, amount: 101_000, previousLeaderId: null,
  });
  check("a notification that cannot be written does not throw", true);
  eq("and nothing was written", (await notesFor(ghost)).length, 0);

  // The bid itself still works.
  const result = await placeBid(item.id, bidder.id, 101_000);
  check("the bid still succeeds", result.ok, JSON.stringify(result));
  eq("and is recorded",
    await prisma.bid.count({ where: { auctionItemId: item.id } }), 1);
}
{
  // The same guarantee through the real ordering: notify runs after placeBid
  // has returned, so even a total failure of the bell leaves the bid standing.
  const seller = await user("s");
  const bidder = await user("b");
  const item = await auction(seller.id, { buyNowPrice: null });

  const result = await placeBid(item.id, bidder.id, 101_000);
  check("placeBid succeeds on its own", result.ok);

  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: randomUUID(),
    bidderId: bidder.id, amount: 101_000, previousLeaderId: randomUUID(),
  });
  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("and the auction is unchanged by the failure", after.currentPrice, 101_000);
}

console.log("\nPUSH IS OPTIONAL");
{
  // VAPID is unset in this suite, so nothing above attempted a push — and all
  // of it still worked. That is the contract: the bell is the product, push is
  // an announcement of it.
  check("no VAPID key is configured here",
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const seller = await user("s");
  const item = await auction(seller.id);
  await notifyBidPlaced({
    itemId: item.id, itemTitle: item.title, sellerId: seller.id,
    bidderId: (await user("b")).id, amount: 101_000, previousLeaderId: null,
  });
  eq("and the notification was still written", (await notesFor(seller.id)).length, 1);
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nnotifications hold" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
