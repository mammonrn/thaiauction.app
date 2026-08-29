/**
 * Automatic payouts: the arithmetic, the gate, and the double-click.
 *
 * Half of this runs against the real Omise TEST API, because the whole feature
 * rests on facts about Omise that its own documentation and its own
 * `/account` response get wrong — the transfer fee, the minimum, and what
 * "created" does and does not mean. Those facts are asserted here rather than
 * only written down, so the day Omise changes one this suite says so.
 *
 *   DATABASE_URL=... OMISE_SECRET_KEY=skey_test_... \
 *     npx tsx --conditions=react-server scripts/payouts.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import {
  createRecipient,
  createTransfer,
  recipientUsable,
  retrieveRecipient,
  type OmiseRecipient,
} from "../lib/omise";
import { COMMISSION_PERCENT, splitPayment } from "../lib/payment-math";
import {
  MIN_TRANSFER_SATANG,
  planPayout,
  splitPaymentWithTransfer,
  transferFeeFor,
} from "../lib/payout-math";
import { notifyPayoutSent } from "../lib/notifications";
import {
  approvePayout,
  backfillRecipients,
  reconcileRecipients,
  syncRecipient,
} from "../lib/payouts";

if (!process.env.OMISE_SECRET_KEY?.startsWith("skey_test_")) {
  throw new Error("payouts.test refuses to run without a TEST secret key");
}

// Every function under test reads the flag at call time. The suite is about
// what happens when it is ON; the flag-OFF half asserts the old arithmetic is
// untouched, which needs no flag at all.
process.env.PAYOUT_RECIPIENTS_ENABLED = "1";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const AUTH = `Basic ${Buffer.from(`${process.env.OMISE_SECRET_KEY}:`).toString("base64")}`;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         ${detail}`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

/* ------------------------------------------------------------------ fixtures */

const createdTransfers: string[] = [];
const createdRecipients: string[] = [];

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
  await prisma.bid.deleteMany({ where: { auctionItemId: { in: itemIds } } });
  await prisma.auctionItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.bankAccountChange.deleteMany({ where: { userId: { in: ids } } });
  await prisma.sellerBankAccount.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function seller(tag: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
      name: `ผู้ขาย ${tag}`,
      firstName: "สมชาย",
      lastName: "ทดสอบ",
    },
  });
}

async function bankAccount(
  userId: string,
  overrides: Partial<{
    omiseRecipientId: string | null;
    recipientStatus: "pending" | "verified" | "failed";
    accountNumber: string;
  }> = {},
) {
  return prisma.sellerBankAccount.create({
    data: {
      userId,
      bankCode: "bbl",
      accountNumber: overrides.accountNumber ?? "1234567890",
      accountName: "สมชาย ทดสอบ",
      nameMatchesKyc: true,
      omiseRecipientId:
        overrides.omiseRecipientId === undefined ? null : overrides.omiseRecipientId,
      recipientStatus: overrides.recipientStatus ?? "pending",
    },
  });
}

/**
 * Point one seller at the shared usable recipient, taking it off whoever had it.
 *
 * `omiseRecipientId` is unique, and deliberately so: two sellers pointed at one
 * destination is a misdirected payout waiting to happen. Only one recipient on
 * this TEST account can actually receive money, so the fixtures pass it between
 * them — which is the same move a seller changing banks makes, in reverse.
 */
async function giveRecipient(userId: string, recipientId: string) {
  await prisma.sellerBankAccount.updateMany({
    where: { omiseRecipientId: recipientId },
    data: { omiseRecipientId: null, recipientStatus: "pending" },
  });
  await prisma.sellerBankAccount.update({
    where: { userId },
    data: { omiseRecipientId: recipientId, recipientStatus: "verified" },
  });
}

/** A settled sale, ready to be paid out. */
async function settledSale(sellerId: string, net: number) {
  const category = await prisma.category.upsert({
    where: { slug: "amulets" },
    update: {},
    create: { name: "พระเครื่อง", slug: "amulets" },
  });
  const buyer = await seller("buyer");
  const amount = net + 3_600 + 252;

  const item = await prisma.auctionItem.create({
    data: {
      sellerId,
      categoryId: category.id,
      title: `ของทดสอบ ${randomUUID().slice(0, 6)}`,
      description: "x",
      images: [],
      condition: "used",
      startPrice: amount,
      currentPrice: amount,
      bidIncrement: 1_000,
      status: "ended",
      paymentState: "paid",
      winnerId: buyer.id,
    },
  });

  const split = splitPaymentWithTransfer({ amount, fee: 3_600, feeVat: 252, net });

  const payment = await prisma.payment.create({
    data: {
      auctionItemId: item.id,
      payerId: buyer.id,
      method: "promptpay",
      status: "successful",
      omiseChargeId: `chrg_test_fixture_${randomUUID().slice(0, 12)}`,
      amount,
      fee: 3_600,
      feeVat: 252,
      net,
      commission: split?.commission ?? null,
      sellerNet: split?.sellerNet ?? null,
      transferFee: split?.transferFee ?? null,
      paidAt: new Date(),
    },
  });

  return { item, payment, buyer, amount };
}

/**
 * A recipient money can actually be sent to.
 *
 * Recipients this suite creates can be VERIFIED — `POST /recipients/{id}/verify`
 * works in test mode — but never ACTIVATED: `POST /recipients/{id}/activate` is
 * 403 "This API is not allowed" and `auto_activate_recipients` on the account is
 * false and cannot be PATCHed. A transfer needs both, so the only destination
 * that can really receive money here is the account's own default recipient,
 * which Omise ships already verified and active.
 *
 * Found rather than hard-coded, so the suite runs against any TEST account.
 */
async function usableRecipientId(): Promise<string | null> {
  const response = await fetch("https://api.omise.co/recipients?limit=100", {
    headers: { Authorization: AUTH },
    cache: "no-store",
  });
  const list = (await response.json()) as { data: OmiseRecipient[] };
  const usable = list.data.find((r) => recipientUsable(r));
  return usable?.id ?? null;
}

/** Test-mode only: make Omise say a recipient is verified. */
async function markVerifiedAtOmise(recipientId: string): Promise<void> {
  await fetch(`https://api.omise.co/recipients/${recipientId}/verify`, {
    method: "POST",
    headers: { Authorization: AUTH },
    cache: "no-store",
  });
}

/**
 * Delete every unsent transfer this suite is responsible for.
 *
 * Belt to the tracked ids' braces: a transfer created by a call that then threw,
 * or by a race whose loser still reached Omise, has no id anywhere in this
 * process. They are recognised by the metadata every transfer here carries, so
 * a transfer made by anything else is left alone.
 */
async function sweepUnsentTransfers(): Promise<void> {
  const response = await fetch("https://api.omise.co/transfers?limit=100", {
    headers: { Authorization: AUTH },
    cache: "no-store",
  });
  const list = (await response.json()) as {
    data: { id: string; sent: boolean; paid: boolean; metadata: Record<string, string> | null }[];
  };
  for (const transfer of list.data) {
    const kind = transfer.metadata?.kind;
    if (kind !== "payout" && kind !== "probe") continue;
    if (transfer.sent || transfer.paid) continue;
    await deleteAtOmise(`transfers/${transfer.id}`);
  }
}

async function deleteAtOmise(path: string): Promise<void> {
  await fetch(`https://api.omise.co/${path}`, {
    method: "DELETE",
    headers: { Authorization: AUTH },
    cache: "no-store",
  }).catch(() => {});
}

/* ------------------------------------------------------------------- money */

function moneySection() {
  console.log("\nTHE SPLIT — EVERY SATANG HAS A PLACE");

  // The identity the whole feature rests on, over every net a real sale could
  // produce: ฿0.01 through ฿150,000 (PromptPay's own ceiling), plus the tier
  // boundary and the numbers either side of it.
  const nets = [
    1, 100, 1_999, 2_000, 2_001, 2_100, 3_000, 5_000, 9_999, 10_000, 50_000,
    99_999, 100_000, 123_457, 500_000, 961_000, 1_000_000, 5_000_000,
    14_999_999, 15_000_000, 199_999_999, 200_000_000, 200_000_001, 250_000_000,
  ];

  let balanced = 0;
  let refused = 0;
  const broken: string[] = [];

  for (const net of nets) {
    const result = planPayout(net);
    if (!result.ok) {
      refused++;
      continue;
    }
    const p = result.plan;

    if (p.commission + p.sellerNet + p.transferFee !== net) {
      broken.push(`net=${net}: ${p.commission}+${p.sellerNet}+${p.transferFee}`);
      continue;
    }
    if (p.transferAmount !== p.sellerNet + p.transferFee) {
      broken.push(`net=${net}: transferAmount ${p.transferAmount}`);
      continue;
    }
    if (p.transferFee !== transferFeeFor(p.transferAmount)) {
      broken.push(`net=${net}: fee tier ${p.transferFee} for ${p.transferAmount}`);
      continue;
    }
    if (p.commission !== Math.floor((net - p.transferFee) / 10)) {
      broken.push(`net=${net}: commission ${p.commission}`);
      continue;
    }
    balanced++;
  }

  check(
    `commission + sellerNet + transferFee === net for all ${balanced} payable amounts`,
    broken.length === 0,
    broken.join("; "),
  );
  check("and the too-small ones are refused rather than fudged", refused > 0);

  // The full chain, from what the buyer paid.
  const charge = { amount: 1_000_000, fee: 36_449, feeVat: 2_551, net: 961_000 };
  const split = splitPaymentWithTransfer(charge);
  check("a settled charge splits", split !== null);
  if (split) {
    eq("  transfer fee is ฿20", split.transferFee, 2_000);
    eq("  commission is 10% of what is left after it", split.commission, 95_900);
    eq("  the seller gets the rest", split.sellerNet, 863_100);
    eq(
      "  and it all adds back to what the buyer paid",
      split.commission + split.sellerNet + split.transferFee + split.fee + split.feeVat,
      charge.amount,
    );
  }

  // Rounding never falls the platform's way, same rule as the old split.
  const odd = planPayout(2_009);
  check("a fractional commission is floored", odd.ok && odd.plan.commission === 0, JSON.stringify(odd));

  eq("the transfer fee tier is ฿20 up to ฿2,000,000", transferFeeFor(200_000_000), 2_000);
  eq("and ฿150 one satang above it", transferFeeFor(200_000_001), 15_000);

  const tooSmall = planPayout(2_000);
  check("a sale that cannot cover the fee is refused", !tooSmall.ok, JSON.stringify(tooSmall));
  eq("Omise's floor is recorded as ฿20.01", MIN_TRANSFER_SATANG, 2_001);
}

function flagOffSection() {
  console.log("\nFLAG OFF — THE OLD SPLIT IS UNTOUCHED");

  // splitPayment is what runs when PAYOUT_RECIPIENTS_ENABLED is unset. Pinned
  // here as well as in the payment suites, because this is the function the new
  // one had to leave alone.
  const charge = { amount: 1_000_000, fee: 36_449, feeVat: 2_551, net: 961_000 };
  const old = splitPayment(charge);
  eq("commission is still 10% of net itself", old.commission, 96_100);
  eq("the seller still gets net minus commission", old.sellerNet, 864_900);
  eq("no transfer fee exists in it", "transferFee" in old, false);
  eq(
    "and it still adds back to what the buyer paid",
    old.commission + old.sellerNet + old.fee + old.feeVat,
    charge.amount,
  );
  eq("the commission rate did not move", COMMISSION_PERCENT, 10);

  check(
    "the new split takes strictly less for the platform than the old one",
    old.commission > 95_900,
  );
}

/* -------------------------------------------------------------- omise facts */

async function omiseFactsSection(recipientId: string) {
  console.log("\nWHAT OMISE ACTUALLY DOES (against the TEST API)");

  const transfer = await createTransfer({
    amountSatang: 10_000,
    recipientId,
    metadata: { kind: "probe" },
  });
  createdTransfers.push(transfer.id);

  eq("a ฿100 transfer is charged ฿20", transfer.total_fee, 2_000);
  eq("  split as fee ฿18.69", transfer.fee, 1_869);
  eq("  plus 7% VAT", transfer.fee_vat, 131);
  eq(
    "the fee comes OUT of the amount, not off a separate balance",
    transfer.net,
    transfer.amount - transfer.total_fee,
  );

  const big = await createTransfer({
    amountSatang: 1_000_000,
    recipientId,
    metadata: { kind: "probe" },
  });
  createdTransfers.push(big.id);
  eq("a ฿10,000 transfer is charged the same ฿20 — a step, not a percentage", big.total_fee, 2_000);
  eq("  and the tier table agrees", transferFeeFor(1_000_000), big.total_fee);

  // The account's own transfer_config disagrees with both of the above. That is
  // the reason this section exists at all.
  const account = await (
    await fetch("https://api.omise.co/account", {
      headers: { Authorization: AUTH },
      cache: "no-store",
    })
  ).json();
  check(
    "the account's own transfer_config.fee does NOT match what is charged",
    account.transfer_config?.fee !== "20.00",
    `transfer_config.fee=${account.transfer_config?.fee} but the API charged ฿20.00`,
  );

  // Creation is not sending.
  const unusable = await createRecipient({
    name: "ทดสอบ ปลายทาง",
    email: "probe@example.com",
    bankCode: "kbank",
    accountNumber: "9876543210",
    accountName: "ทดสอบ ปลายทาง",
  });
  createdRecipients.push(unusable.id);
  eq("a fresh recipient is not verified", unusable.verified, false);
  eq("nor active", unusable.active, false);

  const stillborn = await createTransfer({
    amountSatang: 10_000,
    recipientId: unusable.id,
    metadata: { kind: "probe" },
  });
  createdTransfers.push(stillborn.id);
  check(
    "a transfer to an unusable recipient is ACCEPTED, not refused",
    stillborn.id.startsWith("trsf_"),
  );
  eq("  but comes back sendable: false", stillborn.sendable, false);

  await markVerifiedAtOmise(unusable.id);
  const verified = await retrieveRecipient(unusable.id);
  eq("verifying it sets verified", verified.verified, true);
  eq("  but leaves it inactive", verified.active, false);
  eq("  so it is still not usable", recipientUsable(verified), false);

  const stillStillborn = await createTransfer({
    amountSatang: 10_000,
    recipientId: unusable.id,
    metadata: { kind: "probe" },
  });
  createdTransfers.push(stillStillborn.id);
  eq(
    "and a transfer to it is still not sendable — active is the gate, not verified",
    stillStillborn.sendable,
    false,
  );
}

/* ------------------------------------------------------------------ payouts */

async function payoutSection(recipientId: string) {
  console.log("\nAPPROVING A PAYOUT");

  const admin = await seller("admin");

  {
    const person = await seller("ready");
    await bankAccount(person.id);
    await giveRecipient(person.id, recipientId);
    const sale = await settledSale(person.id, 961_000);

    const result = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("a verified seller is paid", result.ok, JSON.stringify(result));

    if (result.ok) {
      createdTransfers.push(result.transferId);
      eq("  the seller receives what the statement promised", result.sellerNet, 863_100);
      eq("  and the fee was the predicted one", result.transferFee, 2_000);

      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: sale.payment.id },
        select: {
          transferStatus: true,
          transferAmount: true,
          transferNet: true,
          transferFee: true,
          commission: true,
          sellerNet: true,
          net: true,
          payoutStatus: true,
          payoutReference: true,
          omiseTransferId: true,
        },
      });
      eq("  the row records the transfer", row.omiseTransferId, result.transferId);
      eq("  it leaves the payout queue", row.payoutStatus, "transferred");
      eq("  the transfer id is the reference", row.payoutReference, result.transferId);
      eq("  what was asked of Omise", row.transferAmount, 865_100);
      eq("  what Omise says lands", row.transferNet, 863_100);
      eq(
        "  and the books balance against the real figures",
        (row.commission ?? 0) + (row.sellerNet ?? 0) + (row.transferFee ?? 0),
        row.net,
      );
    }
  }

  {
    const person = await seller("unverified");
    await bankAccount(person.id, { recipientStatus: "pending" });
    const sale = await settledSale(person.id, 961_000);

    const result = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("an unverified seller cannot be paid", !result.ok, JSON.stringify(result));
    if (!result.ok) eq("  and is told why", result.reason, "recipient_not_ready");

    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: sale.payment.id },
      select: { transferStatus: true, payoutStatus: true },
    });
    eq("  no transfer was claimed", row.transferStatus, null);
    eq("  and it stays in the queue", row.payoutStatus, "pending");
  }

  {
    const person = await seller("nobank");
    const sale = await settledSale(person.id, 961_000);
    const result = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("a seller with no bank account cannot be paid", !result.ok);
    if (!result.ok) eq("  and is told why", result.reason, "no_bank_account");
  }

  {
    const person = await seller("tiny");
    await bankAccount(person.id);
    await giveRecipient(person.id, recipientId);
    const sale = await settledSale(person.id, 1_500);
    const result = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("a sale too small to cover the transfer fee is refused", !result.ok);
    if (!result.ok) eq("  and named as such", result.reason, "below_minimum");
  }

  console.log("\nTWO ADMINS, ONE CLICK EACH");
  {
    const person = await seller("raced");
    await bankAccount(person.id);
    await giveRecipient(person.id, recipientId);
    const sale = await settledSale(person.id, 500_000);
    const second = await seller("admin2");

    const [a, b] = await Promise.all([
      approvePayout({ paymentId: sale.payment.id, adminId: admin.id }),
      approvePayout({ paymentId: sale.payment.id, adminId: second.id }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    eq("exactly one of two simultaneous approvals goes through", winners.length, 1);
    for (const w of winners) if (w.ok) createdTransfers.push(w.transferId);

    const loser = [a, b].find((r) => !r.ok);
    if (loser && !loser.ok) {
      eq("  the other is told it is already done", loser.reason, "already_transferred");
    }

    const transfers = await prisma.payment.count({
      where: { id: sale.payment.id, omiseTransferId: { not: null } },
    });
    eq("  and one transfer exists", transfers, 1);

    const again = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("pressing it a third time changes nothing", !again.ok);
    if (!again.ok) eq("  same answer", again.reason, "already_transferred");
  }

  console.log("\nA FAILED TRANSFER GOES BACK IN THE QUEUE");
  {
    const person = await seller("retried");
    // A recipient id Omise has never heard of: a real gateway error, not a
    // simulated one.
    await bankAccount(person.id, {
      omiseRecipientId: `recp_test_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      recipientStatus: "verified",
    });
    const sale = await settledSale(person.id, 300_000);

    const failed = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("a transfer Omise refuses fails", !failed.ok, JSON.stringify(failed));

    const afterFail = await prisma.payment.findUniqueOrThrow({
      where: { id: sale.payment.id },
      select: { transferStatus: true, transferFailureMessage: true, omiseTransferId: true },
    });
    eq("  the row is marked failed", afterFail.transferStatus, "failed");
    check("  with the reason on it", (afterFail.transferFailureMessage ?? "").length > 0);
    eq("  and no transfer id was recorded", afterFail.omiseTransferId, null);

    // The seller fixes their account; the admin presses again.
    await giveRecipient(person.id, recipientId);
    const retry = await approvePayout({ paymentId: sale.payment.id, adminId: admin.id });
    check("retrying after the fix works", retry.ok, JSON.stringify(retry));
    if (retry.ok) createdTransfers.push(retry.transferId);

    const count = await prisma.payment.count({
      where: { id: sale.payment.id, transferStatus: { in: ["pending", "sent", "paid"] } },
    });
    eq("  and there is still only one live transfer", count, 1);
  }
}

/* --------------------------------------------------------------- recipients */

async function recipientSection() {
  console.log("\nRECIPIENTS FOLLOW THE BANK ACCOUNT");

  const person = await seller("recipient");
  await bankAccount(person.id);

  const first = await syncRecipient(person.id);
  check("saving a bank account creates a recipient", first.ok, JSON.stringify(first));
  if (!first.ok) return;
  createdRecipients.push(first.recipientId);

  const again = await syncRecipient(person.id);
  check("syncing again creates nothing", again.ok && !again.created, JSON.stringify(again));

  const stored = await prisma.sellerBankAccount.findUniqueOrThrow({
    where: { userId: person.id },
    select: { omiseRecipientId: true, recipientStatus: true, recipientCreatedAt: true },
  });
  eq("  the id is on the account", stored.omiseRecipientId, first.recipientId);
  eq("  and it starts out unverified", stored.recipientStatus, "pending");
  check("  with a creation time", stored.recipientCreatedAt !== null);

  // Omise decides.
  await markVerifiedAtOmise(first.recipientId);
  await reconcileRecipients();
  const afterSweep = await prisma.sellerBankAccount.findUniqueOrThrow({
    where: { userId: person.id },
    select: { recipientStatus: true, recipientCheckedAt: true },
  });
  check("the sweep records what Omise said", afterSweep.recipientCheckedAt !== null);
  // verified-but-inactive is not usable, so the sweep must NOT call it ready.
  eq("  a verified but inactive recipient is not 'พร้อมรับเงิน'", afterSweep.recipientStatus, "pending");

  console.log("\nCHANGING BANKS REPLACES THE DESTINATION");
  {
    const old = first.recipientId;
    // What the bank form's save does when the details change.
    await prisma.$transaction([
      prisma.bankAccountChange.create({
        data: {
          userId: person.id,
          previousBankCode: "bbl",
          previousAccountNumber: "1234567890",
          previousAccountName: "สมชาย ทดสอบ",
          previousOmiseRecipientId: old,
          newBankCode: "kbank",
          newAccountNumber: "5555544444",
          newAccountName: "สมชาย ทดสอบ",
          newNameMatchesKyc: true,
          authorisedByPhone: "0812345678",
        },
      }),
      prisma.sellerBankAccount.update({
        where: { userId: person.id },
        data: {
          bankCode: "kbank",
          accountNumber: "5555544444",
          omiseRecipientId: null,
          recipientStatus: "pending",
          recipientVerifiedAt: null,
          recipientCheckedAt: null,
        },
      }),
    ]);

    const replacement = await syncRecipient(person.id);
    check("a new recipient is created", replacement.ok, JSON.stringify(replacement));
    if (replacement.ok) {
      createdRecipients.push(replacement.recipientId);
      check("  and it is a different one", replacement.recipientId !== old);

      const now = await prisma.sellerBankAccount.findUniqueOrThrow({
        where: { userId: person.id },
        select: { omiseRecipientId: true },
      });
      eq("  the account points at the new one", now.omiseRecipientId, replacement.recipientId);

      const audit = await prisma.bankAccountChange.findFirstOrThrow({
        where: { userId: person.id },
        orderBy: { changedAt: "desc" },
        select: { previousOmiseRecipientId: true },
      });
      eq("  and the old one is in the audit trail", audit.previousOmiseRecipientId, old);
    }
  }

  console.log("\nBACKFILL");
  {
    const one = await seller("backfill-a");
    const two = await seller("backfill-b");
    await bankAccount(one.id, { accountNumber: "1111122222" });
    await bankAccount(two.id, { accountNumber: "3333344444" });

    const firstRun = await backfillRecipients();
    check("the backfill creates the missing ones", firstRun.created >= 2, JSON.stringify(firstRun));

    for (const id of [one.id, two.id]) {
      const row = await prisma.sellerBankAccount.findUniqueOrThrow({
        where: { userId: id },
        select: { omiseRecipientId: true },
      });
      if (row.omiseRecipientId) createdRecipients.push(row.omiseRecipientId);
    }

    const secondRun = await backfillRecipients();
    eq("running it again creates nothing", secondRun.created, 0);

    const ids = await prisma.sellerBankAccount.findMany({
      where: { userId: { in: [one.id, two.id] } },
      select: { omiseRecipientId: true },
    });
    check(
      "and every account still has exactly one recipient",
      ids.every((r) => r.omiseRecipientId !== null),
    );
  }
}

/* ----------------------------------------------------------- telling people */

/**
 * The seller is told when the money LEAVES, not when the transfer is created.
 *
 * A transfer on this TEST account is created `sent: false` and stays there —
 * Omise does not run its sending schedule in test mode — so the transition that
 * fires this in production cannot be observed here. What can be pinned is the
 * notification itself: its wording, where it points, and that a sweep running
 * every fifteen minutes cannot say it twice.
 */
async function payoutNoticeSection() {
  console.log("\nTELLING THE SELLER");

  const person = await seller("notified");
  const paymentId = `pay_${randomUUID().slice(0, 12)}`;

  await notifyPayoutSent({
    paymentId,
    itemTitle: "พระสมเด็จวัดระฆัง",
    sellerId: person.id,
    amount: 863_100,
  });
  await notifyPayoutSent({
    paymentId,
    itemTitle: "พระสมเด็จวัดระฆัง",
    sellerId: person.id,
    amount: 863_100,
  });

  const notes = await prisma.notification.findMany({
    where: { userId: person.id, type: "payout_sent" },
    select: { title: true, body: true, url: true },
  });
  eq("the sweep can run twice and say it once", notes.length, 1);
  if (notes[0]) {
    eq("  it says the money went", notes[0].title, "โอนเงินให้แล้ว");
    check("  with the figure in it", notes[0].body.includes("8,631.00"), notes[0].body);
    eq("  and points at the seller's sales", notes[0].url, "/sell");
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  await resetFixtures();

  moneySection();
  flagOffSection();

  const recipientId = await usableRecipientId();
  if (!recipientId) {
    console.log(
      "\n  SKIP  no verified+active recipient on this TEST account — the live transfer tests need one",
    );
    failures++;
  } else {
    await omiseFactsSection(recipientId);
    await payoutSection(recipientId);
  }

  await recipientSection();
  await payoutNoticeSection();

  // Leave the TEST account as it was found. Unsent transfers and recipients can
  // both be deleted; a suite that litters one makes the next run's balance and
  // recipient list lie — and after a few runs the recipient list is useless for
  // finding the one recipient that can actually receive money.
  //
  // The tracked ids are not enough on their own: backfillRecipients creates a
  // recipient for every fixture bank account, not only the ones named here. So
  // the accounts are read back before they are deleted.
  const strays = await prisma.sellerBankAccount.findMany({
    where: {
      omiseRecipientId: { not: null },
      user: { email: { endsWith: "@example.com" } },
    },
    select: { omiseRecipientId: true },
  });
  const recipientIds = new Set([
    ...createdRecipients,
    ...strays.map((r) => r.omiseRecipientId).filter((id): id is string => id !== null),
  ]);
  // Never the account's own default recipient: it is not ours to delete, and it
  // is the only one the next run can transfer to.
  const keep = await usableRecipientId();

  for (const id of new Set(createdTransfers)) await deleteAtOmise(`transfers/${id}`);
  await sweepUnsentTransfers();
  for (const id of recipientIds) {
    if (id !== keep) await deleteAtOmise(`recipients/${id}`);
  }
  await resetFixtures();

  console.log(failures === 0 ? "\npayouts hold" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[payouts.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
