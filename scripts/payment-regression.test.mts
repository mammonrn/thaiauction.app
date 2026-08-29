/**
 * Card and PromptPay, as they behave TODAY.
 *
 * Written and passed against unmodified lib/payments.ts and lib/omise.ts
 * before phase 2 touched either, so that "nothing changed for the existing
 * methods" is a measurement rather than a claim. Every assertion here must
 * still hold afterwards, unaltered.
 *
 * Runs against the real Omise TEST API. Test keys only — the client refuses a
 * live key without OMISE_ALLOW_LIVE, and this suite never sets it. It creates
 * charges, so it must never be pointed at a production database.
 *
 *   DATABASE_URL=... OMISE_PUBLIC_KEY=pkey_test_... OMISE_SECRET_KEY=skey_test_... \
 *     npx tsx --conditions=react-server scripts/payment-regression.test.mts
 *
 * `.mts`, not `.ts`: the file has top-level await, which tsx can only load as
 * ESM, and a `.ts` under this tsconfig is required as CJS.
 *
 * `--conditions=react-server` is required: lib/payments.ts imports "server-only",
 * whose export map resolves to an empty module under that condition and to a
 * throwing one otherwise.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  startCardPayment,
  startPromptPayPayment,
  refreshPayment,
  reconcilePayments,
  QR_WINDOW_MS,
} from "../lib/payments";
import { retrieveCharge } from "../lib/omise";
import { splitPayment, COMMISSION_PERCENT } from "../lib/payment-math";

if (!process.env.OMISE_SECRET_KEY?.startsWith("skey_test_")) {
  throw new Error("payment-regression refuses to run without a TEST secret key");
}

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

/** Cards whose behaviour was verified directly against the TEST API. */
const CARD_OK = "4242424242424242";
const CARD_INSUFFICIENT = "4111111111140011";
const CARD_REJECTED = "4111111111110014";

async function token(number: string): Promise<string> {
  const body = new URLSearchParams({
    "card[name]": "Test Buyer",
    "card[number]": number,
    "card[expiration_month]": "12",
    "card[expiration_year]": "2030",
    "card[security_code]": "123",
  });
  const res = await fetch("https://vault.omise.co/tokens", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.OMISE_PUBLIC_KEY}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { id?: string; message?: string };
  if (!json.id) throw new Error(`tokenise failed: ${json.message}`);
  return json.id;
}

/** A won auction whose deadline has not passed, ready to be paid for. */
async function wonAuction(amountSatang = 250_000) {
  const suffix = randomUUID().slice(0, 8);
  const seller = await prisma.user.create({
    data: { id: randomUUID(), email: `s-${suffix}@example.com`, name: "ผู้ขาย" },
  });
  const buyer = await prisma.user.create({
    data: { id: randomUUID(), email: `b-${suffix}@example.com`, name: "ผู้ซื้อ" },
  });
  const category = await prisma.category.upsert({
    where: { slug: "amulets" },
    update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  const item = await prisma.auctionItem.create({
    data: {
      sellerId: seller.id, categoryId: category.id, title: `ของทดสอบ ${suffix}`,
      description: "x", images: [], startPrice: amountSatang, currentPrice: amountSatang,
      bidIncrement: 100, status: "ended", condition: "used",
      endedAt: new Date(), endReason: "expired",
      winnerId: buyer.id, paymentState: "awaiting_payment",
      paymentDueAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  return { seller, buyer, item };
}


/**
 * Clear what earlier runs of this suite left behind.
 *
 * Not tidiness: `reconcilePayments` sweeps EVERY pending row, so a database
 * carrying sixty abandoned fixtures from previous runs makes it list charges
 * back to the oldest of them, and the assertions about this run's rows then
 * pass or fail depending on how many times the suite has been run before. A
 * test whose result depends on its own history is not a measurement.
 *
 * Scoped to @example.com, which only the fixtures use — a real account cannot
 * be deleted by this, and the suite still refuses to run without a TEST key.
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
  // Tables added by later features. A fixture user cannot be deleted while a
  // ban they issued or a notification addressed to them still points at it.
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.itemReport.deleteMany({
    where: { OR: [{ auctionItemId: { in: itemIds } }, { reporterId: { in: ids } }, { reviewedById: { in: ids } }] },
  });
  await prisma.userBan.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { bannedById: { in: ids } }] },
  });
  await prisma.auctionItem.updateMany({
    where: { deletedById: { in: ids } },
    data: { deletedById: null },
  });
  await prisma.payment.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.paymentStrike.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.bid.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

await resetFixtures();

console.log("\nCARD");
{
  const { buyer, item } = await wonAuction();
  const result = await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  check("a good card succeeds", result.ok, JSON.stringify(result));

  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq("status is successful", row.status, "successful");
  eq("method recorded", row.method, "card");
  eq("amount came from the auction row", row.amount, 250_000);
  check("the real Omise charge id was stored", row.omiseChargeId.startsWith("chrg_"), row.omiseChargeId);
  check("fee/vat/net are Omise's own numbers", row.fee !== null && row.feeVat !== null && row.net !== null);
  eq("net = amount - fee - feeVat", row.net, row.amount - (row.fee ?? 0) - (row.feeVat ?? 0));

  const split = splitPayment({ amount: row.amount, fee: row.fee!, feeVat: row.feeVat!, net: row.net! });
  eq(`commission is ${COMMISSION_PERCENT}% of net, floored`, row.commission, split.commission);
  eq("sellerNet = net - commission", row.sellerNet, row.net! - row.commission!);
  eq("commission + sellerNet accounts for every satang of net", row.commission! + row.sellerNet!, row.net);
  check("paidAt was set", row.paidAt !== null);

  const settled = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("the auction is marked paid", settled.paymentState, "paid");
  eq("the deadline was cleared", settled.paymentDueAt, "null");

  // The charge at Omise must agree with the row.
  const charge = await retrieveCharge(row.omiseChargeId);
  eq("Omise agrees the charge succeeded", charge.status, "successful");
  eq("Omise's amount matches ours", charge.amount, row.amount);
}

console.log("\nCARD DECLINES");
for (const [card, code, label] of [
  [CARD_INSUFFICIENT, "insufficient_fund", "insufficient funds"],
  [CARD_REJECTED, "payment_rejected", "payment rejected"],
] as const) {
  const { buyer, item } = await wonAuction();
  const result = await startCardPayment(item.id, buyer.id, await token(card));
  check(`${label}: reported synchronously, not as "started"`, !result.ok);
  check(`${label}: reason is "declined"`, !result.ok && result.reason === "declined",
    JSON.stringify(result));
  check(`${label}: the buyer gets a Thai message`,
    !result.ok && /[฀-๿]/.test(result.message ?? ""), JSON.stringify(result));

  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq(`${label}: row recorded as failed`, row.status, "failed");
  eq(`${label}: Omise's code stored for audit`, row.failureCode, code);
  check(`${label}: Omise's English message kept`, (row.failureMessage ?? "").length > 0);

  const still = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq(`${label}: the auction is NOT paid`, still.paymentState, "awaiting_payment");

  // A failed attempt must not hold the pending slot.
  const retry = await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  check(`${label}: the buyer can retry immediately`, retry.ok, JSON.stringify(retry));
}

console.log("\nPROMPTPAY");
{
  const { buyer, item } = await wonAuction();
  const result = await startPromptPayPayment(item.id, buyer.id);
  check("a QR charge is created", result.ok, JSON.stringify(result));

  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq("status is pending", row.status, "pending");
  eq("method recorded", row.method, "promptpay");
  check("a QR image uri was stored", (row.qrDownloadUri ?? "").startsWith("http"), String(row.qrDownloadUri));
  check("an expiry was stored", row.expiresAt !== null);

  const window = row.expiresAt!.getTime() - row.createdAt.getTime();
  check(`the QR window is ${QR_WINDOW_MS / 60000} minutes`,
    Math.abs(window - QR_WINDOW_MS) < 90_000, `${Math.round(window / 1000)}s`);

  check("no money figures until it settles",
    row.fee === null && row.net === null && row.paidAt === null);

  // Polling an unpaid QR must not invent a settlement.
  await refreshPayment(row.id);
  const after = await prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
  eq("polling an unscanned QR leaves it pending", after.status, "pending");
  const stillUnpaid = await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } });
  eq("and the auction stays unpaid", stillUnpaid.paymentState, "awaiting_payment");
}

console.log("\nTHE PARTIAL UNIQUE INDEXES");
{
  const { buyer, item } = await wonAuction();
  await startPromptPayPayment(item.id, buyer.id);
  const second = await startPromptPayPayment(item.id, buyer.id);
  check("a second attempt while one is pending is refused",
    !second.ok && second.reason === "attempt_in_flight", JSON.stringify(second));
  const card = await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  check("and refused for a different method too",
    !card.ok && card.reason === "attempt_in_flight", JSON.stringify(card));
  eq("exactly one payment row exists",
    await prisma.payment.count({ where: { auctionItemId: item.id } }), 1);
}
{
  const { buyer, item } = await wonAuction();
  await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  const again = await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  check("a paid auction refuses another attempt",
    !again.ok && (again.reason === "already_paid" || again.reason === "attempt_in_flight"),
    JSON.stringify(again));
  eq("still exactly one successful payment",
    await prisma.payment.count({ where: { auctionItemId: item.id, status: "successful" } }), 1);
}

console.log("\nWHO MAY PAY, AND WHEN");
{
  const { item } = await wonAuction();
  const stranger = await prisma.user.create({
    data: { id: randomUUID(), email: `x-${randomUUID().slice(0, 8)}@example.com`, name: "คนอื่น" },
  });
  const result = await startCardPayment(item.id, stranger.id, await token(CARD_OK));
  check("a non-winner cannot pay", !result.ok && result.reason === "not_winner", JSON.stringify(result));
  eq("and no row was created", await prisma.payment.count({ where: { auctionItemId: item.id } }), 0);
}
{
  const { buyer, item } = await wonAuction();
  await prisma.auctionItem.update({
    where: { id: item.id }, data: { paymentDueAt: new Date(Date.now() - 1000) },
  });
  const result = await startCardPayment(item.id, buyer.id, await token(CARD_OK));
  check("a passed deadline refuses the charge",
    !result.ok && result.reason === "deadline_passed", JSON.stringify(result));
}
{
  // PROMPTPAY_MIN_SATANG is 2,000 SATANG (THB 20), not THB 2,000. THB 10 is
  // genuinely under the floor.
  const { buyer, item } = await wonAuction(1_000);
  const result = await startPromptPayPayment(item.id, buyer.id);
  check("PromptPay refuses an amount below its floor",
    !result.ok && result.reason === "amount_out_of_range", JSON.stringify(result));
}

console.log("\nRECONCILE");
{
  const { buyer, item } = await wonAuction();
  await startPromptPayPayment(item.id, buyer.id);
  const before = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  const out = await reconcilePayments();
  check("a pending charge is refreshed", out.refreshed.includes(before.id), JSON.stringify(out));
  const after = await prisma.payment.findUniqueOrThrow({ where: { id: before.id } });
  eq("and left pending because nobody paid it", after.status, "pending");
}
{
  // A row reserved but never charged, older than the grace period: the sweep
  // must fail it so the buyer is not locked out.
  const { buyer, item } = await wonAuction();
  const orphan = await prisma.payment.create({
    data: {
      auctionItemId: item.id, payerId: buyer.id, method: "promptpay", status: "pending",
      amount: 250_000, omiseChargeId: `reserved:${randomUUID()}`,
      createdAt: new Date(Date.now() - 30 * 60_000),
    },
  });
  const out = await reconcilePayments();
  check("an orphaned reservation is abandoned", out.abandoned.includes(orphan.id), JSON.stringify(out));
  const after = await prisma.payment.findUniqueOrThrow({ where: { id: orphan.id } });
  eq("it is marked failed", after.status, "failed");
  const retry = await startPromptPayPayment(item.id, buyer.id);
  check("so the buyer can start again", retry.ok, JSON.stringify(retry));
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nbaseline holds" : `\n${failures} REGRESSION(S)`);
process.exit(failures === 0 ? 0 : 1);
