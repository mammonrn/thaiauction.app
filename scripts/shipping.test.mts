/**
 * Shipping status, tracking numbers, and the frozen delivery address.
 *
 * No gateway and no network: shipping is database work only, so this needs
 * just a throwaway PostgreSQL.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/shipping.test.mts
 *
 * `.mts` for top-level await; `--conditions=react-server` because lib/shipping
 * imports "server-only". Same reasons as the other suites here.
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  formatShipTo,
  markShipped,
  shipToOf,
  updateTrackingNumber,
} from "../lib/shipping";

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

/** Clear earlier runs, so a result never depends on how often this has run. */
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
  // bannedById is Restrict, so bans ISSUED by a fixture must go too.
  await prisma.userBan.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
  });
  await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.paymentStrike.deleteMany({ where: { userId: { in: ids } } });
  await prisma.bid.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.shippingAddress.deleteMany({ where: { userId: { in: ids } } });
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

const ADDRESS = {
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  addressLine: "99/1 หมู่ 4 ซอยลาดพร้าว 15",
  subDistrict: "จอมพล",
  district: "จตุจักร",
  province: "กรุงเทพมหานคร",
  postalCode: "10900",
};

/** A sold auction, paid for unless told otherwise, with the address frozen on. */
async function soldItem(
  sellerId: string,
  buyerId: string,
  options: { paid?: boolean; withAddress?: boolean } = {},
) {
  const category = await prisma.category.upsert({
    where: { slug: "amulets" },
    update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  const paid = options.paid ?? true;
  return prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: category.id,
      title: `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: 250_000,
      currentPrice: 250_000,
      bidIncrement: 1_000,
      status: "ended",
      endedAt: new Date(),
      endReason: "expired",
      winnerId: buyerId,
      paymentState: paid ? "paid" : "awaiting_payment",
      paymentDueAt: paid ? null : new Date(Date.now() + 86_400_000),
      ...(options.withAddress === false
        ? {}
        : {
            shipToName: ADDRESS.recipientName,
            shipToPhone: ADDRESS.phone,
            shipToLine: ADDRESS.addressLine,
            shipToSubDistrict: ADDRESS.subDistrict,
            shipToDistrict: ADDRESS.district,
            shipToProvince: ADDRESS.province,
            shipToPostalCode: ADDRESS.postalCode,
          }),
    },
  });
}

await resetFixtures();

console.log("\nMARKING AN ORDER SHIPPED");
{
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);

  eq("starts as not_shipped", item.shippingStatus, "not_shipped");
  eq("with no tracking number", item.trackingNumber, null);

  const result = await markShipped(item.id, { kind: "seller", userId: seller.id }, "TH1234567890");
  check("the seller can mark it shipped", result.ok, JSON.stringify(result));

  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("the status moves", after.shippingStatus, "shipped");
  eq("and the tracking number is stored", after.trackingNumber, "TH1234567890");
}

console.log("\nWHO MAY MARK IT SHIPPED");
{
  const seller = await user("s");
  const buyer = await user("b");
  const stranger = await user("x");
  const item = await soldItem(seller.id, buyer.id);

  eq("a stranger cannot",
    ((await markShipped(item.id, { kind: "seller", userId: stranger.id }, "TH1")) as { reason?: string }).reason,
    "not_found");
  eq("the BUYER cannot either",
    ((await markShipped(item.id, { kind: "seller", userId: buyer.id }, "TH1")) as { reason?: string }).reason,
    "not_found");
  eq("and nothing was written",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).shippingStatus,
    "not_shipped");

  const asAdmin = await markShipped(item.id, { kind: "admin" }, "TH999");
  check("an admin can, on someone else's sale", asAdmin.ok, JSON.stringify(asAdmin));
  eq("and it really is shipped",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).shippingStatus,
    "shipped");
}

console.log("\nA BLANK TRACKING NUMBER");
{
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);
  const actor = { kind: "seller" as const, userId: seller.id };

  eq("empty is refused",
    ((await markShipped(item.id, actor, "")) as { reason?: string }).reason,
    "no_tracking_number");
  eq("spaces only is refused too",
    ((await markShipped(item.id, actor, "   ")) as { reason?: string }).reason,
    "no_tracking_number");
  eq("a tab is not a tracking number either",
    ((await markShipped(item.id, actor, "\t\n ")) as { reason?: string }).reason,
    "no_tracking_number");
  eq("so the order is still unshipped",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).shippingStatus,
    "not_shipped");

  const padded = await markShipped(item.id, actor, "  TH42  ");
  check("surrounding spaces are trimmed rather than refused", padded.ok, JSON.stringify(padded));
  eq("and the stored number has none",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).trackingNumber,
    "TH42");
}

console.log("\nSHIPPING IS ONE-WAY");
{
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);
  const actor = { kind: "seller" as const, userId: seller.id };

  await markShipped(item.id, actor, "TH-FIRST");
  eq("marking it shipped twice is refused",
    ((await markShipped(item.id, actor, "TH-SECOND")) as { reason?: string }).reason,
    "already_shipped");
  eq("and the first tracking number survives",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).trackingNumber,
    "TH-FIRST");

  // There is no API that moves it back. The library exports markShipped and
  // updateTrackingNumber only, and neither writes not_shipped.
  eq("an admin cannot reverse it either",
    ((await markShipped(item.id, { kind: "admin" }, "TH-THIRD")) as { reason?: string }).reason,
    "already_shipped");
  eq("the status is still shipped",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).shippingStatus,
    "shipped");

  // Correcting a typo is a separate operation that leaves the status alone.
  const fixed = await updateTrackingNumber(item.id, actor, "TH-CORRECTED");
  check("but the number can be corrected", fixed.ok, JSON.stringify(fixed));
  const after = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("the corrected number is stored", after.trackingNumber, "TH-CORRECTED");
  eq("and the status did not move", after.shippingStatus, "shipped");
  eq("a correction cannot be blank either",
    ((await updateTrackingNumber(item.id, actor, "  ")) as { reason?: string }).reason,
    "no_tracking_number");
  eq("a stranger cannot correct it",
    ((await updateTrackingNumber(item.id, { kind: "seller", userId: buyer.id }, "TH-X")) as { reason?: string }).reason,
    "not_found");
}

console.log("\nNOTHING SHIPS BEFORE IT IS PAID FOR");
{
  const seller = await user("s");
  const buyer = await user("b");
  const unpaid = await soldItem(seller.id, buyer.id, { paid: false });

  eq("an unpaid order cannot be marked shipped",
    ((await markShipped(unpaid.id, { kind: "seller", userId: seller.id }, "TH1")) as { reason?: string }).reason,
    "not_paid");
  eq("not even by an admin",
    ((await markShipped(unpaid.id, { kind: "admin" }, "TH1")) as { reason?: string }).reason,
    "not_paid");
  eq("and it stays unshipped",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: unpaid.id } })).shippingStatus,
    "not_shipped");
}

console.log("\nCORRECTING A NUMBER BEFORE ANYTHING SHIPPED");
{
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);
  eq("there is nothing to correct yet",
    ((await updateTrackingNumber(item.id, { kind: "seller", userId: seller.id }, "TH1")) as { reason?: string }).reason,
    "not_found");
}

console.log("\nTHE FROZEN ADDRESS");
{
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);

  const snapshot = shipToOf(item);
  check("an order carries the address it was bought with", snapshot !== null);
  eq("the recipient", snapshot?.recipientName, ADDRESS.recipientName);
  eq("the postcode", snapshot?.postalCode, ADDRESS.postalCode);
  check("and it formats as one line for a parcel",
    formatShipTo(snapshot!).includes("จตุจักร") && formatShipTo(snapshot!).includes("10900"),
    formatShipTo(snapshot!));

  // The point of copying rather than linking: the buyer's address book is a
  // live thing, and a sold order must go on saying where it was sent.
  const book = await prisma.shippingAddress.create({
    data: {
      userId: buyer.id,
      recipientName: ADDRESS.recipientName,
      phone: ADDRESS.phone,
      addressLine: ADDRESS.addressLine,
      subDistrict: ADDRESS.subDistrict,
      district: ADDRESS.district,
      province: ADDRESS.province,
      postalCode: ADDRESS.postalCode,
      isDefault: true,
    },
  });

  await prisma.shippingAddress.update({
    where: { id: book.id },
    data: { addressLine: "ย้ายบ้านแล้ว 123", province: "เชียงใหม่", postalCode: "50000" },
  });
  const afterEdit = shipToOf(
    await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } }),
  );
  eq("editing the address book does not move a sold order",
    afterEdit?.addressLine, ADDRESS.addressLine);
  eq("nor its province", afterEdit?.province, ADDRESS.province);

  await prisma.shippingAddress.delete({ where: { id: book.id } });
  const afterDelete = shipToOf(
    await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } }),
  );
  check("and deleting it outright leaves the order intact", afterDelete !== null);
  eq("with the address still readable", afterDelete?.postalCode, ADDRESS.postalCode);
}
{
  // Orders that predate the snapshot must not crash a page.
  const seller = await user("s");
  const buyer = await user("b");
  const legacy = await soldItem(seller.id, buyer.id, { withAddress: false });
  eq("an order with no address reads as null", shipToOf(legacy), null);
  check("and can still be marked shipped — the seller may know where it goes",
    (await markShipped(legacy.id, { kind: "seller", userId: seller.id }, "TH-LEGACY")).ok);
}
{
  // A half-written snapshot is not a usable address.
  const seller = await user("s");
  const buyer = await user("b");
  const item = await soldItem(seller.id, buyer.id);
  await prisma.auctionItem.update({
    where: { id: item.id },
    data: { shipToPostalCode: null },
  });
  eq("a partial address reads as null rather than half an address",
    shipToOf(await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })),
    null);
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nshipping holds" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
