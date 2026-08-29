import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  chargeCardToken,
  chargePromptPaySource,
  chargeRedirectSource,
  createInstallmentSource,
  createPromptPaySource,
  createShopeePaySource,
  expireCharge,
  listCharges,
  OmiseApiError,
  promptPayQrUri,
  PROMPTPAY_MAX_SATANG,
  PROMPTPAY_MIN_SATANG,
  retrieveCharge,
  type OmiseCharge,
} from "@/lib/omise";
import {
  INSTALLMENT_MAX_SATANG,
  INSTALLMENT_MIN_SATANG,
  isOfferedInstallment,
} from "@/lib/payment-methods";
import { failureMessage } from "@/lib/omise-failures";
import { splitPayment, type PaymentBreakdown } from "@/lib/payment-math";
import { splitPaymentWithTransfer } from "@/lib/payout-math";
import { recipientPayoutsEnabled } from "@/lib/payouts";
import { prisma } from "@/lib/prisma";

/**
 * Paying for a won auction.
 *
 * Three rules hold everywhere in this file:
 *
 *  1. The AMOUNT always comes from the auction row, never from the request.
 *     A buyer who edits the form gets charged what they owe regardless.
 *  2. The STATUS is only ever written from a Retrieve Charge response. Nothing
 *     the browser reports about a payment is believed — the browser is not a
 *     party to whether money actually moved.
 *  3. Double payment is prevented by two partial unique indexes in PostgreSQL,
 *     not by an application-level "has this been paid?" check. Two concurrent
 *     requests can both pass such a check; only one can win a unique index.
 */

/** How long a PromptPay QR stays scannable. */
export const QR_WINDOW_MS = 15 * 60 * 1000;

/**
 * How long a redirect attempt (instalments, ShopeePay) may stay open.
 *
 * Longer than the QR window because the buyer leaves the site entirely: they
 * have to reach a bank's page or open the ShopeePay app, possibly install it,
 * possibly log in, and come back. Fifteen minutes would strand people who are
 * genuinely trying to pay.
 *
 * ShopeePay honours this as expires_at. Instalments IGNORE it and keep Omise's
 * seven-day default — verified against the TEST API — so for those it is the
 * deadline this project enforces itself, by expiring the charge when the buyer
 * returns unsuccessful or asks to start again.
 */
export const REDIRECT_WINDOW_MS = 45 * 60 * 1000;

/**
 * Where Omise returns the buyer to.
 *
 * The payment id is in the URL, but nothing is believed because of it: the
 * return page checks that the signed-in user owns that payment and then
 * re-reads the charge from Omise. A guessed id gets a 404, and a tampered one
 * cannot make a payment look paid.
 */
function returnUriFor(origin: string, paymentId: string): string {
  return `${origin}/payments/return?p=${encodeURIComponent(paymentId)}`;
}

/**
 * Whether each phase-2 method is switched on.
 *
 * Read at call time, not at import time, so a deploy can turn a method on or
 * off by restarting rather than rebuilding. Both default to OFF: this code can
 * ship to production without offering anything new until the owner decides.
 */
export function installmentsEnabled(): boolean {
  return process.env.PAYMENT_INSTALLMENTS_ENABLED === "1";
}

export function shopeePayEnabled(): boolean {
  return process.env.PAYMENT_SHOPEEPAY_ENABLED === "1";
}

/**
 * How long a charge may sit with no Omise id before the sweep gives up on it.
 * Long enough that a slow API call is never mistaken for a crash.
 */
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

/** Placeholder ids are written before the charge exists; see startPayment. */
const PLACEHOLDER_PREFIX = "reserved:";

export type StartPaymentFailure =
  | "not_found"
  | "not_winner"
  | "not_due"
  | "deadline_passed"
  | "already_paid"
  | "attempt_in_flight"
  | "amount_out_of_range"
  | "declined"
  | "method_unavailable"
  | "invalid_installment"
  | "gateway_error";

export type StartPaymentResult =
  | { ok: true; paymentId: string }
  /** Redirect methods hand back the URL the buyer must be sent to. */
  | { ok: true; paymentId: string; authorizeUri: string }
  | { ok: false; reason: StartPaymentFailure; message?: string };

/** The auction facts a payment attempt depends on, read under the row lock. */
type PayableAuction = {
  id: string;
  title: string;
  winnerId: string | null;
  currentPrice: number;
  paymentState: string;
  paymentDueAt: Date | null;
};

/**
 * Reserve the right to charge this buyer, atomically.
 *
 * Takes the auction's row lock — the same one bidding and forfeiting use, so a
 * payment starting cannot race the deadline sweep moving the item to somebody
 * else. Inserts a row with a PLACEHOLDER charge id, because the real id does
 * not exist until Omise has been called and calling Omise from inside a
 * transaction would hold the lock open across a network round trip.
 *
 * The placeholder is what makes the ordering safe: the row (and therefore the
 * one-pending-attempt index) is claimed BEFORE any charge is created, so two
 * simultaneous "pay" clicks cannot both reach Omise.
 */
/**
 * The buyer's chosen delivery address, copied onto the auction.
 *
 * Taken when the attempt is RESERVED rather than when the charge succeeds,
 * because the redirect methods settle later and somewhere else: an instalment
 * buyer is on their bank's page when the charge completes, and there is no
 * request carrying their address at that point. Reserving is the last moment
 * the buyer is definitely here.
 *
 * Writing it on a failed attempt is harmless — it is only read once the item
 * is paid, and the next attempt overwrites it — so this needs no unwinding.
 *
 * The values are copied, not linked. See the schema note on shipTo*: an
 * address book row is one the buyer keeps editing, and a sold order has to go
 * on saying where it was actually sent.
 */
export type ShipTo = {
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

async function reserveAttempt(
  itemId: string,
  userId: string,
  method: "card" | "promptpay" | "installment" | "shopeepay",
  extra?: {
    installmentBank?: string;
    installmentTerm?: number;
    shipTo?: ShipTo;
  },
): Promise<
  | { ok: true; paymentId: string; amount: number; title: string }
  | { ok: false; reason: StartPaymentFailure }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PayableAuction[]>`
        SELECT id, title, "winnerId", "currentPrice", "paymentState",
               "paymentDueAt"
        FROM auction_items
        WHERE id = ${itemId}
        FOR UPDATE
      `;
      const item = rows[0];
      if (!item) return { ok: false, reason: "not_found" } as const;

      // Only the person who currently holds the right to buy may pay, and only
      // while they hold it. Both are re-read here under the lock rather than
      // trusted from the page that rendered the button.
      if (item.winnerId !== userId) {
        return { ok: false, reason: "not_winner" } as const;
      }
      if (item.paymentState === "paid") {
        return { ok: false, reason: "already_paid" } as const;
      }
      if (item.paymentState !== "awaiting_payment") {
        return { ok: false, reason: "not_due" } as const;
      }
      if (item.paymentDueAt && item.paymentDueAt.getTime() <= Date.now()) {
        return { ok: false, reason: "deadline_passed" } as const;
      }

      if (
        method === "promptpay" &&
        (item.currentPrice < PROMPTPAY_MIN_SATANG ||
          item.currentPrice > PROMPTPAY_MAX_SATANG)
      ) {
        return { ok: false, reason: "amount_out_of_range" } as const;
      }

      // Re-checked under the lock against the auction's own price, not the
      // one the page was rendered with. A buyer cannot pick a term for an
      // amount and then be charged a different amount.
      if (
        method === "installment" &&
        (item.currentPrice < INSTALLMENT_MIN_SATANG ||
          item.currentPrice > INSTALLMENT_MAX_SATANG)
      ) {
        return { ok: false, reason: "amount_out_of_range" } as const;
      }

      const payment = await tx.payment.create({
        data: {
          auctionItemId: item.id,
          payerId: userId,
          method,
          status: "pending",
          amount: item.currentPrice,
          installmentBank: extra?.installmentBank ?? null,
          installmentTerm: extra?.installmentTerm ?? null,
          omiseChargeId: `${PLACEHOLDER_PREFIX}${crypto.randomUUID()}`,
        },
        select: { id: true },
      });

      // Inside the same transaction as the reservation, so an attempt can never
      // exist without the address it is being shipped to. Still under the row
      // lock, and touching only the shipTo columns — nothing here reads or
      // writes price, status or payment state.
      if (extra?.shipTo) {
        await tx.auctionItem.update({
          where: { id: item.id },
          data: {
            shipToName: extra.shipTo.recipientName,
            shipToPhone: extra.shipTo.phone,
            shipToLine: extra.shipTo.addressLine,
            shipToSubDistrict: extra.shipTo.subDistrict,
            shipToDistrict: extra.shipTo.district,
            shipToProvince: extra.shipTo.province,
            shipToPostalCode: extra.shipTo.postalCode,
          },
        });
      }

      return {
        ok: true,
        paymentId: payment.id,
        amount: item.currentPrice,
        title: item.title,
      } as const;
    });
  } catch (error) {
    // A unique violation here is the partial index doing its job: either this
    // auction already has a successful payment, or another attempt is in
    // flight. Both are correct outcomes, not faults.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: false, reason: "attempt_in_flight" } as const;
    }
    throw error;
  }
}

/** Mark a reserved attempt as failed when the gateway call never landed. */
async function abandonAttempt(paymentId: string, message: string) {
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "failed",
      failureCode: "gateway_unreachable",
      failureMessage: message,
    },
  });
}

/**
 * Pay by card, using a token the browser produced with Omise.js.
 *
 * The token is the only thing the browser sends. It is a one-time handle to
 * card data this server has never seen and cannot see — which is what keeps
 * the project outside PCI-DSS scope.
 */
export async function startCardPayment(
  itemId: string,
  userId: string,
  token: string,
  /** Where to send it, copied onto the auction. See ShipTo. */
  shipTo?: ShipTo,
): Promise<StartPaymentResult> {
  const reserved = await reserveAttempt(itemId, userId, "card", { shipTo });
  if (!reserved.ok) return reserved;

  let charge: OmiseCharge;
  try {
    charge = await chargeCardToken({
      amountSatang: reserved.amount,
      token,
      description: `thaiauction ${itemId}`,
      metadata: { paymentId: reserved.paymentId, auctionItemId: itemId },
    });
  } catch (error) {
    const message =
      error instanceof OmiseApiError ? error.message : "gateway unreachable";
    await abandonAttempt(reserved.paymentId, message);
    return { ok: false, reason: "gateway_error", message };
  }

  await adoptCharge(reserved.paymentId, charge);

  // A card settles synchronously, so the outcome is known right here. Say so
  // now rather than returning "started" and letting the browser discover the
  // decline on its next poll — the buyer gets the bank's actual reason
  // immediately, and the failed attempt is already recorded either way.
  if (charge.status === "failed") {
    return {
      ok: false,
      reason: "declined",
      message: failureMessage(charge.failure_code, charge.failure_message),
    };
  }

  return { ok: true, paymentId: reserved.paymentId };
}

/**
 * Pay by PromptPay, producing a QR to scan.
 *
 * The source is created server-side so the amount is ours, not the browser's.
 * `expires_at` is always set: Omise has no expire endpoint for PromptPay, so a
 * gateway-enforced window is the only thing that stops an abandoned QR holding
 * the one-pending-attempt slot until the payment deadline runs out.
 */
export async function startPromptPayPayment(
  itemId: string,
  userId: string,
  /** Where to send it, copied onto the auction. See ShipTo. */
  shipTo?: ShipTo,
): Promise<StartPaymentResult> {
  const reserved = await reserveAttempt(itemId, userId, "promptpay", { shipTo });
  if (!reserved.ok) return reserved;

  let charge: OmiseCharge;
  try {
    const source = await createPromptPaySource(reserved.amount);
    charge = await chargePromptPaySource({
      amountSatang: reserved.amount,
      sourceId: source.id,
      description: `thaiauction ${itemId}`,
      expiresAt: new Date(Date.now() + QR_WINDOW_MS),
      metadata: { paymentId: reserved.paymentId, auctionItemId: itemId },
    });
  } catch (error) {
    const message =
      error instanceof OmiseApiError ? error.message : "gateway unreachable";
    await abandonAttempt(reserved.paymentId, message);
    return { ok: false, reason: "gateway_error", message };
  }

  await adoptCharge(reserved.paymentId, charge);
  return { ok: true, paymentId: reserved.paymentId };
}

/**
 * Pay in instalments, through the buyer's own card issuer.
 *
 * The redirect twin of PromptPay: the charge is created here and settles later,
 * so everything downstream — mapChargeStatus, the poll, the reconcile sweep —
 * is the code PromptPay already uses. The only new part is that the buyer has
 * to be sent somewhere, which is what `authorizeUri` carries back.
 *
 * The (bank, term) pair is the one thing the buyer chooses, so it is validated
 * against what this marketplace actually offered FOR THIS AMOUNT rather than
 * against Omise's list. Omise enforces the per-month minimum for SCB, TTB and
 * UOB only; for the other five issuers an under-minimum plan is accepted here
 * and refused at the bank's page, after the redirect, with the auction's one
 * pending slot already spent.
 */
export async function startInstallmentPayment(
  itemId: string,
  userId: string,
  bankCode: string,
  term: number,
  /** Site origin, e.g. "https://thaiauction.app". The return path is built
   *  here because it names the payment, which does not exist until the
   *  reservation below has run. */
  origin: string,
  /** Where to send it, copied onto the auction. See ShipTo. */
  shipTo?: ShipTo,
): Promise<StartPaymentResult> {
  if (!installmentsEnabled()) {
    return { ok: false, reason: "method_unavailable" };
  }

  const reserved = await reserveAttempt(itemId, userId, "installment", {
    installmentBank: bankCode,
    installmentTerm: term,
    shipTo,
  });
  if (!reserved.ok) return reserved;

  // After the reservation, so the amount checked is the one under the lock.
  if (!isOfferedInstallment(reserved.amount, bankCode, term)) {
    await abandonAttempt(reserved.paymentId, "installment plan not offered");
    return { ok: false, reason: "invalid_installment" };
  }

  let charge: OmiseCharge;
  try {
    const source = await createInstallmentSource({
      amountSatang: reserved.amount,
      bankCode,
      term,
    });
    charge = await chargeRedirectSource({
      amountSatang: reserved.amount,
      sourceId: source.id,
      description: `thaiauction ${itemId}`,
      returnUri: returnUriFor(origin, reserved.paymentId),
      expiresAt: new Date(Date.now() + REDIRECT_WINDOW_MS),
      metadata: { paymentId: reserved.paymentId, auctionItemId: itemId },
    });
  } catch (error) {
    const message =
      error instanceof OmiseApiError ? error.message : "gateway unreachable";
    await abandonAttempt(reserved.paymentId, message);
    return { ok: false, reason: "gateway_error", message };
  }

  await adoptCharge(reserved.paymentId, charge);

  if (!charge.authorize_uri) {
    // Nothing to redirect to means the buyer cannot complete this, so the slot
    // is released rather than held by an attempt that can never finish.
    await releaseAttempt(reserved.paymentId, charge.id, "no authorize_uri");
    return { ok: false, reason: "gateway_error", message: "no authorize_uri" };
  }

  return {
    ok: true,
    paymentId: reserved.paymentId,
    authorizeUri: charge.authorize_uri,
  };
}

/**
 * Pay with ShopeePay, by jumping into the app.
 *
 * Offered on phones only, so `platform` is always a real mobile OS; the caller
 * decides that from the browser and the value only chooses which app-store
 * fallback Omise shows.
 *
 * Unlike instalments, ShopeePay honours `expires_at`, so the window here is
 * gateway-enforced. Without one the charge would default to SEVEN DAYS — a
 * buyer who opened the app and changed their mind would hold the auction's one
 * pending slot for a week, well past the payment deadline, and lose the item
 * they had actually won.
 */
export async function startShopeePayPayment(
  itemId: string,
  userId: string,
  platform: "IOS" | "ANDROID",
  /** Site origin; see startInstallmentPayment. */
  origin: string,
  /** Where to send it, copied onto the auction. See ShipTo. */
  shipTo?: ShipTo,
): Promise<StartPaymentResult> {
  if (!shopeePayEnabled()) {
    return { ok: false, reason: "method_unavailable" };
  }

  const reserved = await reserveAttempt(itemId, userId, "shopeepay", { shipTo });
  if (!reserved.ok) return reserved;

  let charge: OmiseCharge;
  try {
    const source = await createShopeePaySource({
      amountSatang: reserved.amount,
      platform,
    });
    charge = await chargeRedirectSource({
      amountSatang: reserved.amount,
      sourceId: source.id,
      description: `thaiauction ${itemId}`,
      returnUri: returnUriFor(origin, reserved.paymentId),
      expiresAt: new Date(Date.now() + REDIRECT_WINDOW_MS),
      metadata: { paymentId: reserved.paymentId, auctionItemId: itemId },
    });
  } catch (error) {
    const message =
      error instanceof OmiseApiError ? error.message : "gateway unreachable";
    await abandonAttempt(reserved.paymentId, message);
    return { ok: false, reason: "gateway_error", message };
  }

  await adoptCharge(reserved.paymentId, charge);

  if (!charge.authorize_uri) {
    await releaseAttempt(reserved.paymentId, charge.id, "no authorize_uri");
    return { ok: false, reason: "gateway_error", message: "no authorize_uri" };
  }

  return {
    ok: true,
    paymentId: reserved.paymentId,
    authorizeUri: charge.authorize_uri,
  };
}

/**
 * Give up on a ShopeePay attempt and free the auction's pending slot.
 *
 * SHOPEEPAY ONLY, and that is a limitation of Omise rather than a choice.
 * Releasing the slot safely requires killing the charge first: the pending row
 * is what holds the slot, and freeing it while a live charge still exists
 * would let a buyer who wanders back to the payment tab pay for an auction
 * this project believes is unpaid — money moving with nothing watching for it,
 * because a released row is no longer polled.
 *
 * Omise will expire a ShopeePay charge on request but refuses outright for
 * instalments ("expiring is not supported for chrg_..."), and instalment
 * charges also ignore expires_at. So an instalment attempt genuinely cannot be
 * called off early, and this returns `cannot_cancel` rather than pretending:
 * the buyer completes it at the bank, or it resolves when Omise's own window
 * closes. The pay page says so before the buyer commits to the method.
 *
 * Expiring at Omise FIRST also handles the race where the buyer paid a moment
 * ago: the call returns a successful charge instead of expiring it, and
 * adoptCharge settles the auction rather than throwing the payment away.
 */
export async function cancelRedirectAttempt(
  paymentId: string,
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, payerId: userId },
    select: { id: true, status: true, method: true, omiseChargeId: true },
  });

  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.method !== "shopeepay") {
    return { ok: false, reason: "cannot_cancel" };
  }
  if (payment.status !== "pending") return { ok: true };
  if (payment.omiseChargeId.startsWith(PLACEHOLDER_PREFIX)) {
    return { ok: false, reason: "no_charge_yet" };
  }

  // Ask Omise first. If the buyer paid in the meantime this returns a
  // successful charge instead of expiring it, and adoptCharge settles the
  // auction rather than throwing the payment away.
  let charge: OmiseCharge;
  try {
    charge = await expireCharge(payment.omiseChargeId);
  } catch (error) {
    // Omise refused. The slot stays held rather than being freed over a live
    // charge — reporting failure is the safe answer, not a silent success.
    const message =
      error instanceof OmiseApiError ? error.message : "gateway unreachable";
    console.error(`[payments] could not expire ${payment.omiseChargeId}: ${message}`);
    return { ok: false, reason: "expire_refused" };
  }

  await adoptCharge(paymentId, charge);
  return { ok: true };
}

/** Mark a reserved attempt failed once its charge is known to be dead. */
async function releaseAttempt(
  paymentId: string,
  chargeId: string,
  message: string,
) {
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      omiseChargeId: chargeId,
      status: "failed",
      failureCode: "unusable_charge",
      failureMessage: message,
    },
  });
}

/**
 * Write a charge's state onto its payment row, and settle the auction if it
 * succeeded.
 *
 * This is the ONLY function that promotes a payment to `successful`, and it
 * only ever acts on an OmiseCharge object — one that came back from Omise's
 * own API. The money split is taken from the charge's real `fee`, `fee_vat`
 * and `net` rather than recomputed from the amount.
 */
async function adoptCharge(paymentId: string, charge: OmiseCharge) {
  const status = mapChargeStatus(charge);

  const money =
    status === "successful" && charge.net !== null
      ? splitSettledCharge({
          amount: charge.amount,
          fee: charge.fee ?? 0,
          feeVat: charge.fee_vat ?? 0,
          net: charge.net,
        })
      : null;

  try {
    await recordCharge(paymentId, charge, status, money);
  } catch (error) {
    // The one-successful-per-auction index fired. That means money moved for an
    // auction that was already paid for, which needs a human and a refund — so
    // it is logged loudly rather than swallowed.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      status === "successful"
    ) {
      console.error(
        `[payments] DOUBLE PAYMENT: charge ${charge.id} succeeded for an auction that is already paid. Refund required.`,
      );
    }
    throw error;
  }
}

async function recordCharge(
  paymentId: string,
  charge: OmiseCharge,
  status: "pending" | "successful" | "failed" | "expired",
  money: (PaymentBreakdown & { transferFee?: number }) | null,
) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: {
        omiseChargeId: charge.id,
        status,
        qrDownloadUri: promptPayQrUri(charge),
        // Kept so a buyer who closed the tab can be handed the same link
        // again; the one-pending index would refuse a second charge anyway.
        authorizeUri: charge.authorize_uri,
        expiresAt: charge.expires_at ? new Date(charge.expires_at) : null,
        failureCode: charge.failure_code,
        failureMessage: charge.failure_message,
        // Omise's own interest figures, recorded for the audit trail. The
        // buyer bears the interest, so this never changes the seller's share:
        // `net` already accounts for whatever Omise deducted.
        interest: charge.interest,
        interestVat: charge.interest_vat,
        ...(money
          ? {
              fee: money.fee,
              feeVat: money.feeVat,
              net: money.net,
              commission: money.commission,
              sellerNet: money.sellerNet,
              // Only under the flag. Null is how the payout path recognises a
              // row whose split predates the transfer fee.
              ...(money.transferFee === undefined
                ? {}
                : { transferFee: money.transferFee }),
              paidAt: new Date(),
            }
          : {}),
      },
      select: { auctionItemId: true },
    });

    if (status === "successful") {
      // Closes the auction's payment lifecycle in the same transaction that
      // records the money, so the two can never disagree.
      await tx.auctionItem.update({
        where: { id: payment.auctionItemId },
        data: { paymentState: "paid", paymentDueAt: null },
      });
    }
  });
}

/**
 * How a settled charge is split. The ONE thing PAYOUT_RECIPIENTS_ENABLED
 * changes inside this file.
 *
 * Flag off: `splitPayment`, and nothing else — the behaviour the payment
 * regression suites pin down, unchanged in every case.
 *
 * Flag on: Omise's transfer fee comes off `net` before the commission, because
 * the money now leaves through the Transfers API and Omise deducts its fee from
 * the transfer itself. See lib/payout-math.ts for the arithmetic and for the
 * measurements it rests on.
 *
 * The new split can DECLINE — a sale too small to cover the transfer fee — and
 * the old one stands in when it does. The money is still owed and still
 * recorded to the satang; it just cannot leave as a transfer, and an admin pays
 * it the way they always have.
 */
function splitSettledCharge(charge: {
  amount: number;
  fee: number;
  feeVat: number;
  net: number;
}): PaymentBreakdown & { transferFee?: number } {
  if (recipientPayoutsEnabled()) {
    const withTransfer = splitPaymentWithTransfer(charge);
    if (withTransfer) return withTransfer;
  }
  return splitPayment(charge);
}

/** Omise's `reversed` never occurs here: every charge is captured on creation. */
function mapChargeStatus(
  charge: OmiseCharge,
): "pending" | "successful" | "failed" | "expired" {
  switch (charge.status) {
    case "successful":
      return "successful";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

/**
 * Re-ask Omise about a payment and record the answer.
 *
 * Called whenever the buyer's page polls, and by the reconcile sweep. This is
 * how a PromptPay QR becomes `successful` — there is no webhook endpoint in
 * this project, by design: Omise's own docs say deliveries are not guaranteed
 * to be retried and that verifying through the API is the alternative, so the
 * API is used as the single source of truth rather than as a second one.
 */
export async function refreshPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { omiseChargeId: true, status: true },
  });

  if (
    !payment ||
    payment.status !== "pending" ||
    payment.omiseChargeId.startsWith(PLACEHOLDER_PREFIX)
  ) {
    return;
  }

  const charge = await retrieveCharge(payment.omiseChargeId);
  await adoptCharge(paymentId, charge);
}

/**
 * Bring every unresolved payment up to date with Omise.
 *
 * Two jobs, both about not losing money:
 *
 *   - pending charges whose buyer closed the tab are re-checked, so a paid QR
 *     still settles the auction;
 *   - reserved rows that never got a charge id are chased through the charge
 *     list by their metadata. That closes the only gap in "reserve, then
 *     charge, then record": a crash in between would otherwise leave a real
 *     charge that no row points at. If no charge turns up after the grace
 *     period, none was created, and the row is failed so the buyer can retry.
 */
export async function reconcilePayments(): Promise<{
  refreshed: string[];
  adopted: string[];
  abandoned: string[];
}> {
  const refreshed: string[] = [];
  const adopted: string[] = [];
  const abandoned: string[] = [];

  const pending = await prisma.payment.findMany({
    where: { status: "pending" },
    select: { id: true, omiseChargeId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const orphans = pending.filter((row) =>
    row.omiseChargeId.startsWith(PLACEHOLDER_PREFIX),
  );

  for (const row of pending) {
    if (row.omiseChargeId.startsWith(PLACEHOLDER_PREFIX)) continue;
    try {
      await refreshPayment(row.id);
      refreshed.push(row.id);
    } catch (error) {
      console.error(`[reconcile] ${row.id} refresh failed:`, error);
    }
  }

  if (orphans.length > 0) {
    const oldest = orphans[0].createdAt;
    let charges: OmiseCharge[] = [];
    try {
      const list = await listCharges({
        from: new Date(oldest.getTime() - 60_000),
        to: new Date(),
      });
      charges = list.data;
    } catch (error) {
      console.error("[reconcile] listing charges failed:", error);
      return { refreshed, adopted, abandoned };
    }

    const byPaymentId = new Map<string, OmiseCharge>();
    for (const charge of charges) {
      const id = charge.metadata?.paymentId;
      if (id) byPaymentId.set(id, charge);
    }

    for (const row of orphans) {
      const charge = byPaymentId.get(row.id);
      if (charge) {
        await adoptCharge(row.id, charge);
        adopted.push(row.id);
        continue;
      }
      if (Date.now() - row.createdAt.getTime() > ORPHAN_GRACE_MS) {
        await abandonAttempt(row.id, "no charge was created");
        abandoned.push(row.id);
      }
    }
  }

  return { refreshed, adopted, abandoned };
}
