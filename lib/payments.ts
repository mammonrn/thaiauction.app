import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  chargeCardToken,
  chargePromptPaySource,
  createPromptPaySource,
  listCharges,
  OmiseApiError,
  promptPayQrUri,
  PROMPTPAY_MAX_SATANG,
  PROMPTPAY_MIN_SATANG,
  retrieveCharge,
  type OmiseCharge,
} from "@/lib/omise";
import { failureMessage } from "@/lib/omise-failures";
import { splitPayment } from "@/lib/payment-math";
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
  | "gateway_error";

export type StartPaymentResult =
  | { ok: true; paymentId: string }
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
async function reserveAttempt(
  itemId: string,
  userId: string,
  method: "card" | "promptpay",
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

      const payment = await tx.payment.create({
        data: {
          auctionItemId: item.id,
          payerId: userId,
          method,
          status: "pending",
          amount: item.currentPrice,
          omiseChargeId: `${PLACEHOLDER_PREFIX}${crypto.randomUUID()}`,
        },
        select: { id: true },
      });

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
): Promise<StartPaymentResult> {
  const reserved = await reserveAttempt(itemId, userId, "card");
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
): Promise<StartPaymentResult> {
  const reserved = await reserveAttempt(itemId, userId, "promptpay");
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
      ? splitPayment({
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
  money: ReturnType<typeof splitPayment> | null,
) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: {
        omiseChargeId: charge.id,
        status,
        qrDownloadUri: promptPayQrUri(charge),
        expiresAt: charge.expires_at ? new Date(charge.expires_at) : null,
        failureCode: charge.failure_code,
        failureMessage: charge.failure_message,
        ...(money
          ? {
              fee: money.fee,
              feeVat: money.feeVat,
              net: money.net,
              commission: money.commission,
              sellerNet: money.sellerNet,
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
