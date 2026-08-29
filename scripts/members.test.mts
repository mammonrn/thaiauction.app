/**
 * The member list: who counts as what, and finding them again.
 *
 * Roles here are DERIVED, not stored, so the only thing worth testing is
 * whether the derivation agrees with the definitions — a bid makes a buyer, an
 * approval makes a seller, both make one row with two badges, and neither still
 * makes a member. Everything else is search, filter and paging over that.
 *
 * The admin gate is NOT tested here. `requireAdmin` reaches for the request's
 * headers through next/navigation, which does not exist outside one, so
 * asserting it in this process would mean asserting a copy of it rather than
 * the thing the page calls. It is proven in the browser instead: a signed-in
 * non-admin asking for /admin/members gets a 404.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/members.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { issueBan } from "../lib/bans";
import {
  listMembers,
  MEMBERS_PER_PAGE,
  parseRoleFilter,
  type MemberRow,
} from "../lib/members";

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

async function member(name: string, options: { phone?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID().slice(0, 6)}@example.com`,
      name,
    },
  });
  if (options.phone) {
    await prisma.verifiedPhone.create({
      data: { userId: user.id, phone: options.phone },
    });
  }
  return user;
}

/** Somebody else's listing, so a bid on it is a real bid. */
async function listingBy(sellerId: string) {
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
      status: "active",
    },
  });
}

/**
 * One bid.
 *
 * The amount is a counter rather than a constant: `bids_auctionItemId_amount`
 * is unique, so two people cannot bid the same figure on one item — which is
 * true of the real thing too, where each bid has to beat the last.
 */
let nextBid = 110_000;
async function bidBy(userId: string, auctionItemId: string) {
  nextBid += 1_000;
  return prisma.bid.create({
    data: { bidderId: userId, auctionItemId, amount: nextBid },
  });
}

async function kyc(
  userId: string,
  status: "pending" | "approved" | "rejected",
  submittedAt = new Date(),
) {
  return prisma.sellerVerification.create({
    data: {
      userId,
      status,
      submittedAt,
      ...(status === "pending" ? {} : { reviewedAt: new Date() }),
    },
  });
}

/** The row for one person, from the unfiltered list. */
async function rowFor(userId: string): Promise<MemberRow | undefined> {
  // The fixtures never exceed one page.
  const { rows } = await listMembers({ page: 1 });
  return rows.find((row) => row.id === userId);
}

/* -------------------------------------------------------------------- tests */

async function rolesSection() {
  console.log("\nWHO COUNTS AS WHAT");

  const host = await member("เจ้าของสินค้า");
  const listing = await listingBy(host.id);

  const bidder = await member("คนบิด");
  await bidBy(bidder.id, listing.id);

  const approved = await member("คนขาย");
  await kyc(approved.id, "approved");

  const dual = await member("ทำทั้งสอง");
  await bidBy(dual.id, listing.id);
  await kyc(dual.id, "approved");

  const idle = await member("สมัครแล้วเงียบ");

  const buyer = await rowFor(bidder.id);
  eq("someone who has bid is a buyer", buyer?.role, "buyer");

  const seller = await rowFor(approved.id);
  eq("someone whose KYC passed is a seller", seller?.role, "seller");
  eq("  even with no listing of their own", seller?.kyc, "approved");

  const both = await rowFor(dual.id);
  eq("someone who does both is both", both?.role, "both");

  const nobody = await rowFor(idle.id);
  check("an account that never did anything is still in the list", nobody !== undefined);
  eq("  with no role", nobody?.role, "none");

  // The whole reason there is one table rather than two.
  const { rows } = await listMembers({ page: 1 });
  eq(
    "a dual-role member appears exactly once",
    rows.filter((row) => row.id === dual.id).length,
    1,
  );

  // A pending or rejected submission does not make a seller.
  const waiting = await member("รอตรวจอยู่");
  await kyc(waiting.id, "pending");
  const waitingRow = await rowFor(waiting.id);
  eq("a pending submission is not yet a seller", waitingRow?.role, "none");
  eq("  but its state is visible", waitingRow?.kyc, "pending");

  const refused = await member("ไม่ผ่าน");
  await kyc(refused.id, "rejected");
  const refusedRow = await rowFor(refused.id);
  eq("a rejected submission is not a seller", refusedRow?.role, "none");
  eq("  and says so", refusedRow?.kyc, "rejected");

  // Resubmitted after a rejection: still a seller once one was approved, and
  // the column follows the newest submission.
  const persistent = await member("ลองใหม่");
  await kyc(persistent.id, "rejected", new Date(Date.now() - 86_400_000));
  await kyc(persistent.id, "approved", new Date());
  const persistentRow = await rowFor(persistent.id);
  eq("an approval after a rejection makes a seller", persistentRow?.role, "seller");
  eq("  and the column shows the latest decision", persistentRow?.kyc, "approved");

  return { bidder, approved, dual, idle, listing, host };
}

async function phoneAndBanSection(context: {
  bidder: { id: string };
  dual: { id: string };
}) {
  console.log("\nPHONE AND BANS");

  const withPhone = await member("มีเบอร์", { phone: "0812345678" });
  const row = await rowFor(withPhone.id);
  eq("a verified number is shown", row?.phone, "0812345678");
  eq("  and marked verified", row?.phoneVerified, true);

  const noPhone = await rowFor(context.bidder.id);
  eq("no number reads as unverified", noPhone?.phoneVerified, false);
  eq("  with nothing to show", noPhone?.phone, null);

  const admin = await member("แอดมิน");
  await issueBan({
    userId: context.dual.id,
    kind: "bidding",
    reason: "ทดสอบ",
    duration: 7,
    bannedById: admin.id,
  });

  const banned = await rowFor(context.dual.id);
  eq("an active ban shows on the row", banned?.bans.length, 1);
  eq("  with its kind", banned?.bans[0]?.kind, "bidding");

  // An expired ban is not an active one, and nothing runs to make that true.
  const lapsed = await member("เคยโดนแบน");
  const ban = await prisma.userBan.create({
    data: {
      userId: lapsed.id,
      kind: "login",
      reason: "หมดอายุแล้ว",
      expiresAt: new Date(Date.now() - 60_000),
      bannedById: admin.id,
    },
  });
  const lapsedRow = await rowFor(lapsed.id);
  eq("a ban that has expired is not shown as active", lapsedRow?.bans.length, 0);

  await prisma.userBan.update({
    where: { id: ban.id },
    data: { expiresAt: null, liftedAt: new Date() },
  });
  const liftedRow = await rowFor(lapsed.id);
  eq("nor is one an admin lifted", liftedRow?.bans.length, 0);

  return { withPhone, admin };
}

async function filterSection(context: {
  bidder: { id: string };
  approved: { id: string };
  dual: { id: string };
  idle: { id: string };
}) {
  console.log("\nFILTERING BY ROLE");

  const buyers = await listMembers({ role: "buyer", page: 1 });
  const buyerIds = buyers.rows.map((row) => row.id);
  check("the buyer filter finds the bidder", buyerIds.includes(context.bidder.id));
  check(
    "  and includes someone who also sells — the filters overlap on purpose",
    buyerIds.includes(context.dual.id),
  );
  check("  and excludes the seller who never bid", !buyerIds.includes(context.approved.id));
  check("  and the account that did nothing", !buyerIds.includes(context.idle.id));

  const sellers = await listMembers({ role: "seller", page: 1 });
  const sellerIds = sellers.rows.map((row) => row.id);
  check("the seller filter finds the approved seller", sellerIds.includes(context.approved.id));
  check("  and the dual-role member", sellerIds.includes(context.dual.id));
  check("  and excludes the bidder", !sellerIds.includes(context.bidder.id));

  const both = await listMembers({ role: "both", page: 1 });
  const bothIds = both.rows.map((row) => row.id);
  eq("the 'both' filter is the overlap, not a union", bothIds.includes(context.dual.id), true);
  check("  so the bidder is out", !bothIds.includes(context.bidder.id));
  check("  and so is the seller", !bothIds.includes(context.approved.id));

  const all = await listMembers({ page: 1 });
  check(
    "everyone is in the unfiltered list",
    [context.bidder.id, context.approved.id, context.dual.id, context.idle.id].every((id) =>
      all.rows.some((row) => row.id === id),
    ),
  );

  eq("an unknown filter value falls back to 'all'", parseRoleFilter("nonsense"), "all");
  eq("as does a missing one", parseRoleFilter(undefined), "all");
  eq("a real one is kept", parseRoleFilter("both"), "both");
}

async function searchSection(context: { withPhone: { id: string } }) {
  console.log("\nSEARCH");

  const target = await prisma.user.findUniqueOrThrow({
    where: { id: context.withPhone.id },
    select: { email: true, name: true },
  });

  const byName = await listMembers({ search: "มีเบอร์", page: 1 });
  check(
    "a name finds the member",
    byName.rows.some((row) => row.id === context.withPhone.id),
    JSON.stringify(byName.rows.map((r) => r.name)),
  );

  const byEmail = await listMembers({ search: target.email, page: 1 });
  eq("an exact email finds exactly one", byEmail.total, 1);

  const byPartialEmail = await listMembers({
    search: target.email.split("@")[0].slice(0, 8),
    page: 1,
  });
  check(
    "part of an email is enough",
    byPartialEmail.rows.some((row) => row.id === context.withPhone.id),
  );

  const byPhone = await listMembers({ search: "0812345678", page: 1 });
  check(
    "a phone number finds them",
    byPhone.rows.some((row) => row.id === context.withPhone.id),
  );

  const byFormattedPhone = await listMembers({ search: "081-234-5678", page: 1 });
  check(
    "  even typed with dashes",
    byFormattedPhone.rows.some((row) => row.id === context.withPhone.id),
  );

  // Search and filter compose rather than replacing each other.
  const combined = await listMembers({ search: "มีเบอร์", role: "seller", page: 1 });
  eq("search and filter apply together", combined.total, 0);

  const missing = await listMembers({ search: "ไม่มีใครชื่อนี้แน่นอน", page: 1 });
  eq("a search that matches nobody returns nobody", missing.total, 0);
  eq("  and one page of nothing", missing.pageCount, 1);
}

async function paginationSection() {
  console.log("\nPAGING");

  // Enough to need a second page whatever the fixtures above left behind.
  const before = await listMembers({ search: "หน้าที่สอง", page: 1 });
  eq("no leftovers from another run", before.total, 0);

  const made: string[] = [];
  for (let i = 0; i < MEMBERS_PER_PAGE + 3; i++) {
    const user = await member(`หน้าที่สอง ${String(i).padStart(2, "0")}`);
    made.push(user.id);
  }

  const first = await listMembers({ search: "หน้าที่สอง", page: 1 });
  eq("the total counts everyone, not just this page", first.total, made.length);
  eq("  a page holds no more than the limit", first.rows.length, MEMBERS_PER_PAGE);
  eq("  and the page count follows", first.pageCount, 2);

  const second = await listMembers({ search: "หน้าที่สอง", page: 2 });
  eq("the rest are on page two", second.rows.length, made.length - MEMBERS_PER_PAGE);

  const firstIds = new Set(first.rows.map((row) => row.id));
  const overlap = second.rows.filter((row) => firstIds.has(row.id));
  eq("no member appears on both pages", overlap.length, 0);

  const seen = new Set([...first.rows, ...second.rows].map((row) => row.id));
  eq("and between them they are all there", seen.size, made.length);

  const past = await listMembers({ search: "หน้าที่สอง", page: 99 });
  eq("a page past the end is empty rather than an error", past.rows.length, 0);
  eq("  and still reports the real total", past.total, made.length);

  const zero = await listMembers({ search: "หน้าที่สอง", page: 0 });
  eq("page 0 is treated as page 1", zero.rows.length, MEMBERS_PER_PAGE);
}

async function main() {
  await resetFixtures();

  const roles = await rolesSection();
  const phones = await phoneAndBanSection(roles);
  await filterSection(roles);
  await searchSection(phones);
  await paginationSection();

  await resetFixtures();

  console.log(failures === 0 ? "\nmembers hold" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[members.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
