/**
 * Instalments and ShopeePay, against the real Omise TEST API.
 *
 *   DATABASE_URL=... OMISE_PUBLIC_KEY=pkey_test_... OMISE_SECRET_KEY=skey_test_... \
 *   PAYMENT_INSTALLMENTS_ENABLED=1 PAYMENT_SHOPEEPAY_ENABLED=1 \
 *     npx tsx --conditions=react-server scripts/payment-phase2.test.mts
 *
 * Creates real TEST charges. Test keys only, and never a production database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  cancelRedirectAttempt,
  installmentsEnabled,
  refreshPayment,
  shopeePayEnabled,
  startInstallmentPayment,
  startShopeePayPayment,
  REDIRECT_WINDOW_MS,
} from "../lib/payments";
import { retrieveCharge } from "../lib/omise";
import {
  INSTALLMENT_BANKS,
  installmentOffers,
  isOfferedInstallment,
  MAX_INSTALLMENT_TERM,
} from "../lib/payment-methods";

if (!process.env.OMISE_SECRET_KEY?.startsWith("skey_test_")) {
  throw new Error("phase2 test refuses to run without a TEST secret key");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ORIGIN = "https://thaiauction.app";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         ${detail}`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

async function wonAuction(amountSatang: number) {
  const suffix = randomUUID().slice(0, 8);
  const seller = await prisma.user.create({
    data: { id: randomUUID(), email: `s2-${suffix}@example.com`, name: "ผู้ขาย" },
  });
  const buyer = await prisma.user.create({
    data: { id: randomUUID(), email: `b2-${suffix}@example.com`, name: "ผู้ซื้อ" },
  });
  const category = await prisma.category.upsert({
    where: { slug: "amulets" }, update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  const item = await prisma.auctionItem.create({
    data: {
      sellerId: seller.id, categoryId: category.id, title: `ของทดสอบ ${suffix}`,
      description: "x", images: [], startPrice: amountSatang, currentPrice: amountSatang,
      bidIncrement: 100, status: "ended", condition: "used",
      endedAt: new Date(), endReason: "expired", winnerId: buyer.id,
      paymentState: "awaiting_payment",
      paymentDueAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  return { buyer, item };
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

console.log("\nFEATURE FLAGS");
check("both flags are on for this run", installmentsEnabled() && shopeePayEnabled());
{
  // The flags must actually gate, not merely exist.
  const saved = process.env.PAYMENT_INSTALLMENTS_ENABLED;
  process.env.PAYMENT_INSTALLMENTS_ENABLED = "";
  const { buyer, item } = await wonAuction(500_000);
  const off = await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  check("instalments off: refused", !off.ok && off.reason === "method_unavailable", JSON.stringify(off));
  eq("instalments off: no row created",
    await prisma.payment.count({ where: { auctionItemId: item.id } }), 0);
  process.env.PAYMENT_INSTALLMENTS_ENABLED = saved;
}
{
  const saved = process.env.PAYMENT_SHOPEEPAY_ENABLED;
  process.env.PAYMENT_SHOPEEPAY_ENABLED = "";
  const { buyer, item } = await wonAuction(500_000);
  const off = await startShopeePayPayment(item.id, buyer.id, "ANDROID", ORIGIN);
  check("shopeepay off: refused", !off.ok && off.reason === "method_unavailable", JSON.stringify(off));
  process.env.PAYMENT_SHOPEEPAY_ENABLED = saved;
}

console.log("\nTERM FILTERING (the per-month minimum Omise does not enforce)");
{
  eq("below THB 2,000 nothing is offered", installmentOffers(199_900).length, 0);
  eq("above THB 150,000 nothing is offered", installmentOffers(15_000_100).length, 0);

  const atFloor = installmentOffers(200_000);
  check("at the floor some issuers still qualify", atFloor.length > 0);
  const worst = atFloor.flatMap((o) =>
    o.terms.map((t) => ({ bank: o.bank.code, term: t.term, per: t.perMonthSatang, min: o.bank.minPerMonthSatang })),
  );
  check("every offered term clears its issuer's monthly minimum",
    worst.every((w) => w.per >= w.min),
    JSON.stringify(worst.filter((w) => w.per < w.min)));
  check(`no term exceeds ${MAX_INSTALLMENT_TERM} months`,
    installmentOffers(15_000_000).every((o) => o.terms.every((t) => t.term <= MAX_INSTALLMENT_TERM)));
  check("first_choice's 18/24/36 are gone",
    !installmentOffers(15_000_000)
      .find((o) => o.bank.code === "first_choice")!
      .terms.some((t) => [18, 24, 36].includes(t.term)));

  // The claim that matters: what we offer, Omise accepts. Proven by asking it.
  const amount = 200_000;
  let checked = 0;
  for (const offer of installmentOffers(amount)) {
    for (const { term } of offer.terms) {
      const res = await fetch("https://api.omise.co/sources", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.OMISE_SECRET_KEY}:`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          amount: String(amount), currency: "THB",
          type: `installment_${offer.bank.code}`, installment_term: String(term),
        }),
      });
      const json = (await res.json()) as { object?: string; message?: string };
      if (json.object === "error") {
        check(`Omise accepts ${offer.bank.code}/${term} at THB 2,000`, false, json.message ?? "");
      }
      checked++;
    }
  }
  check(`all ${checked} offered plans at the floor are accepted by Omise`, true);
}

console.log("\nINSTALMENT CHARGE");
{
  const { buyer, item } = await wonAuction(500_000);
  const result = await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  check("a charge is created", result.ok, JSON.stringify(result));
  check("an authorize_uri comes back",
    result.ok && "authorizeUri" in result && result.authorizeUri.startsWith("https://"),
    JSON.stringify(result));

  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq("method recorded", row.method, "installment");
  eq("bank recorded", row.installmentBank, "kbank");
  eq("term recorded", row.installmentTerm, 6);
  eq("status pending, like PromptPay", row.status, "pending");
  eq("amount came from the auction row", row.amount, 500_000);
  check("authorizeUri stored for a returning buyer", (row.authorizeUri ?? "").startsWith("https://"));

  // The redirect target must actually be reachable.
  const res = await fetch(row.authorizeUri!, { redirect: "follow" });
  eq("GET authorize_uri returns 200", res.status, 200);

  const charge = await retrieveCharge(row.omiseChargeId);
  eq("Omise's source is the right type", charge.source?.type, "installment_kbank");
  eq("Omise's source carries the term", charge.source?.installment_term, 6);
  eq("return_uri points back at us", charge.return_uri, `${ORIGIN}/payments/return?p=${row.id}`);
  check("the auction is NOT settled by creating a charge",
    (await prisma.auctionItem.findUniqueOrThrow({ where: { id: item.id } })).paymentState ===
      "awaiting_payment");
}

console.log("\nREJECTED PLANS");
{
  const { buyer, item } = await wonAuction(200_000);
  // THB 2,000 over 10 months is THB 200/month, under every issuer's minimum.
  check("a plan we never offered is refused before Omise is called",
    !isOfferedInstallment(200_000, "kbank", 10));
  const result = await startInstallmentPayment(item.id, buyer.id, "kbank", 10, ORIGIN);
  check("and the charge is refused", !result.ok && result.reason === "invalid_installment",
    JSON.stringify(result));
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq("the reserved row is released", row.status, "failed");
  const retry = await startInstallmentPayment(item.id, buyer.id, "kbank", 3, ORIGIN);
  check("so the buyer can pick a valid plan", retry.ok, JSON.stringify(retry));
}
{
  const { buyer, item } = await wonAuction(199_000); // under the THB 2,000 floor
  const result = await startInstallmentPayment(item.id, buyer.id, "kbank", 3, ORIGIN);
  check("an amount below the instalment floor is refused",
    !result.ok && result.reason === "amount_out_of_range", JSON.stringify(result));
}

console.log("\nSHOPEEPAY CHARGE");
{
  const { buyer, item } = await wonAuction(500_000);
  const result = await startShopeePayPayment(item.id, buyer.id, "ANDROID", ORIGIN);
  check("a charge is created", result.ok, JSON.stringify(result));
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  eq("method recorded", row.method, "shopeepay");
  check("authorizeUri stored", (row.authorizeUri ?? "").startsWith("https://"));

  const res = await fetch(row.authorizeUri!, { redirect: "follow" });
  eq("GET authorize_uri returns 200", res.status, 200);

  // The whole reason expires_at is sent: Omise's own default is SEVEN DAYS.
  const window = row.expiresAt!.getTime() - row.createdAt.getTime();
  check(`the window is ${REDIRECT_WINDOW_MS / 60000} minutes, not Omise's 7-day default`,
    Math.abs(window - REDIRECT_WINDOW_MS) < 120_000,
    `${Math.round(window / 60000)} minutes`);

  const charge = await retrieveCharge(row.omiseChargeId);
  eq("the source is the jump-app variant", charge.source?.type, "shopeepay_jumpapp");
}

console.log("\nTHE PENDING SLOT");
{
  const { buyer, item } = await wonAuction(500_000);
  await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  const second = await startShopeePayPayment(item.id, buyer.id, "ANDROID", ORIGIN);
  check("a redirect attempt holds the one-pending slot",
    !second.ok && second.reason === "attempt_in_flight", JSON.stringify(second));

  // Omise refuses to expire an instalment charge, so cancelling must REFUSE
  // rather than free our slot over a charge that can still take money.
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  const cancelled = await cancelRedirectAttempt(row.id, buyer.id);
  check("an instalment attempt cannot be cancelled",
    !cancelled.ok && cancelled.reason === "cannot_cancel", JSON.stringify(cancelled));
  eq("and it is still pending — the slot was not freed over a live charge",
    (await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status, "pending");
  eq("Omise still has it pending too",
    (await retrieveCharge(row.omiseChargeId)).status, "pending");
}
{
  // ShopeePay CAN be expired, so cancelling frees the slot for real.
  const { buyer, item } = await wonAuction(500_000);
  await startShopeePayPayment(item.id, buyer.id, "ANDROID", ORIGIN);
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });

  const cancelled = await cancelRedirectAttempt(row.id, buyer.id);
  check("a ShopeePay attempt can be cancelled", cancelled.ok, JSON.stringify(cancelled));
  eq("the row is no longer pending",
    (await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status, "expired");
  eq("and Omise agrees the charge is dead",
    (await retrieveCharge(row.omiseChargeId)).status, "expired");

  const retry = await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  check("so another method can now be started", retry.ok, JSON.stringify(retry));
}
{
  const { buyer, item } = await wonAuction(500_000);
  const stranger = await prisma.user.create({
    data: { id: randomUUID(), email: `x2-${randomUUID().slice(0, 8)}@example.com`, name: "คนอื่น" },
  });
  await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });
  const theirs = await cancelRedirectAttempt(row.id, stranger.id);
  check("a stranger cannot cancel someone else's attempt",
    !theirs.ok && theirs.reason === "not_found", JSON.stringify(theirs));
  eq("and it is still pending",
    (await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status, "pending");
}

console.log("\nEXPIRY RELEASES THE SLOT");
{
  const { buyer, item } = await wonAuction(500_000);
  await startShopeePayPayment(item.id, buyer.id, "ANDROID", ORIGIN);
  const row = await prisma.payment.findFirstOrThrow({ where: { auctionItemId: item.id } });

  // Expire it at Omise directly, then let the ordinary poll notice — this is
  // what happens when a real window simply runs out.
  await fetch(`https://api.omise.co/charges/${row.omiseChargeId}/expire`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.OMISE_SECRET_KEY}:`).toString("base64")}`,
    },
  });
  await refreshPayment(row.id);

  const after = await prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
  eq("the poll records the expiry", after.status, "expired");
  const retry = await startInstallmentPayment(item.id, buyer.id, "kbank", 6, ORIGIN);
  check("an expired charge frees the slot for a new attempt", retry.ok, JSON.stringify(retry));
}

console.log("\nEVERY ENABLED ISSUER CHARGES");
{
  for (const bank of INSTALLMENT_BANKS) {
    const offer = installmentOffers(1_500_000).find((o) => o.bank.code === bank.code);
    if (!offer) { check(`${bank.code}: has an offer at THB 15,000`, false); continue; }
    const term = offer.terms[0].term;
    const { buyer, item } = await wonAuction(1_500_000);
    const result = await startInstallmentPayment(item.id, buyer.id, bank.code, term, ORIGIN);
    check(`${bank.code}/${term}m: charge created with an authorize_uri`,
      result.ok && "authorizeUri" in result, JSON.stringify(result));
  }
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nphase 2 holds" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
