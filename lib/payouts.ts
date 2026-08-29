import "server-only";

import {
  notifyBankRejected,
  notifyBankVerified,
  notifyPayoutSent,
} from "@/lib/notifications";
import {
  createRecipient,
  createTransfer,
  listTransfers,
  OmiseApiError,
  recipientUsable,
  retrieveRecipient,
  retrieveTransfer,
  type OmiseRecipient,
  type OmiseTransfer,
} from "@/lib/omise";
import { planPayout } from "@/lib/payout-math";
import { prisma } from "@/lib/prisma";

/**
 * Paying sellers through Omise instead of by hand.
 *
 * Nothing in here modifies lib/payments.ts's view of a charge. A payout starts
 * where that stops: `net` is already decided and recorded, and this module only
 * decides how much of it moves and sends it.
 *
 * The whole thing is behind PAYOUT_RECIPIENTS_ENABLED. With the flag off no
 * recipient is created, no transfer is attempted, and /admin/payouts is the
 * manual flow it has always been — which is the point: the manual path stays
 * live and reviewable until this one has been watched on production.
 *
 * Two sweeps rather than webhooks, following the precedent lib/payments.ts set:
 * Omise does not guarantee webhook delivery and this project has no endpoint to
 * receive them, so state is only ever read back from the API.
 */

/**
 * Read at call time, not at import time — a build has no environment, and a
 * flag flipped on the VPS should take effect on restart rather than rebuild.
 */
export function recipientPayoutsEnabled(): boolean {
  return process.env.PAYOUT_RECIPIENTS_ENABLED === "1";
}

/* ------------------------------------------------------------- recipients */

/**
 * Mirror one seller's saved bank account to Omise.
 *
 * Called after a save, and again by the sweep for anything the save could not
 * finish. It is the sweep, not the caller, that makes this reliable: saving a
 * bank account must not fail because a payment gateway is having an afternoon,
 * so the action calls this and ignores the outcome, and an account left without
 * a recipient is picked up on the next run.
 *
 * Idempotent on `omiseRecipientId`: an account that already points at a
 * recipient is left alone. Replacing one is the bank-change flow's job, which
 * clears the id in the same transaction that writes the new details — so an
 * account with new digits and no recipient is exactly what this looks for.
 */
export async function syncRecipient(userId: string): Promise<
  { ok: true; recipientId: string; created: boolean } | { ok: false; reason: string }
> {
  const account = await prisma.sellerBankAccount.findUnique({
    where: { userId },
    select: {
      omiseRecipientId: true,
      bankCode: true,
      accountNumber: true,
      accountName: true,
      user: { select: { email: true, name: true } },
    },
  });
  if (!account) return { ok: false, reason: "no_bank_account" };
  if (account.omiseRecipientId) {
    return { ok: true, recipientId: account.omiseRecipientId, created: false };
  }

  let recipient: OmiseRecipient;
  try {
    recipient = await createRecipient({
      // Omise's `name` is the recipient's own name; the bank account carries
      // the holder name separately. Both come from what the seller typed on
      // the bank form, because that is what the bank will match against.
      name: account.accountName,
      email: account.user.email,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
    });
  } catch (error) {
    const message =
      error instanceof OmiseApiError ? `${error.code}: ${error.message}` : String(error);
    console.error("[payouts] createRecipient failed:", message);
    // Recorded, not thrown: the seller's save already succeeded, and the sweep
    // will try again. A rejection Omise is sure about (bad account number) is
    // recorded as a failure so the seller is told to fix it.
    await prisma.sellerBankAccount.updateMany({
      where: { userId, omiseRecipientId: null },
      data: { recipientCheckedAt: new Date(), recipientFailureCode: codeOf(error) },
    });
    return { ok: false, reason: message };
  }

  // Guarded on omiseRecipientId still being null, so two concurrent saves
  // cannot both attach: the loser's recipient is left orphaned at Omise rather
  // than overwriting a live destination.
  const { count } = await prisma.sellerBankAccount.updateMany({
    where: { userId, omiseRecipientId: null },
    data: {
      omiseRecipientId: recipient.id,
      recipientStatus: recipientUsable(recipient) ? "verified" : "pending",
      recipientCreatedAt: new Date(),
      recipientVerifiedAt: recipientUsable(recipient) ? new Date() : null,
      recipientFailureCode: recipient.failure_code,
      recipientCheckedAt: new Date(),
    },
  });
  if (count === 0) return { ok: false, reason: "raced" };

  return { ok: true, recipientId: recipient.id, created: true };
}

/**
 * Create the recipients that do not exist yet.
 *
 * This is the backfill AND the retry, deliberately the same code: "every seller
 * with a bank account and no recipient" describes both the sellers who signed
 * up before this existed and the ones whose creation call failed this morning.
 * A backfill that is merely the steady-state sweep cannot drift away from it.
 */
export async function backfillRecipients(limit = 200): Promise<{
  considered: number;
  created: number;
  failed: number;
}> {
  const pending = await prisma.sellerBankAccount.findMany({
    where: { omiseRecipientId: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { userId: true },
  });

  let created = 0;
  let failed = 0;
  for (const account of pending) {
    const result = await syncRecipient(account.userId);
    if (result.ok && result.created) created++;
    else if (!result.ok) failed++;
  }

  return { considered: pending.length, created, failed };
}

/**
 * Ask Omise what became of the recipients still being checked.
 *
 * Oldest check first, so nothing starves behind a queue of newer accounts.
 * A recipient Omise has deleted, or one it rejected, becomes `failed` and the
 * seller is told — a payout that silently never happens is the worst outcome
 * available here.
 */
export async function reconcileRecipients(limit = 100): Promise<{
  checked: number;
  verified: number;
  failed: number;
}> {
  const waiting = await prisma.sellerBankAccount.findMany({
    where: { recipientStatus: "pending", omiseRecipientId: { not: null } },
    orderBy: { recipientCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { userId: true, omiseRecipientId: true },
  });

  let verified = 0;
  let failed = 0;

  for (const account of waiting) {
    const recipientId = account.omiseRecipientId;
    if (!recipientId) continue;

    let recipient: OmiseRecipient;
    try {
      recipient = await retrieveRecipient(recipientId);
    } catch (error) {
      console.error("[payouts] retrieveRecipient failed:", recipientId, error);
      await prisma.sellerBankAccount.update({
        where: { userId: account.userId },
        data: { recipientCheckedAt: new Date() },
      });
      continue;
    }

    const usable = recipientUsable(recipient);
    // Deleted counts as rejected: whatever the reason, money cannot go there
    // and the seller has to save the account again.
    const rejected = recipient.failure_code !== null || recipient.deleted;

    await prisma.sellerBankAccount.update({
      where: { userId: account.userId },
      data: {
        recipientStatus: usable ? "verified" : rejected ? "failed" : "pending",
        recipientVerifiedAt: usable
          ? recipient.verified_at
            ? new Date(recipient.verified_at)
            : new Date()
          : null,
        recipientFailureCode: recipient.failure_code,
        recipientCheckedAt: new Date(),
      },
    });

    if (usable) {
      verified++;
      await notifyBankVerified({ sellerId: account.userId, recipientId });
    } else if (rejected) {
      failed++;
      await notifyBankRejected({
        sellerId: account.userId,
        recipientId,
        reason: recipient.failure_code ?? "บัญชีถูกปฏิเสธ",
      });
    }
  }

  return { checked: waiting.length, verified, failed };
}

/* ---------------------------------------------------------------- transfers */

export type ApprovePayoutFailure =
  | "not_found"
  | "not_settled"
  | "already_transferred"
  | "no_bank_account"
  | "recipient_not_ready"
  | "below_minimum"
  | "transfer_refused"
  | "gateway_error";

export type ApprovePayoutResult =
  | { ok: true; transferId: string; sellerNet: number; transferFee: number }
  | { ok: false; reason: ApprovePayoutFailure; detail?: string };

/**
 * Send one seller their share. The whole of what the admin's button does.
 *
 * The order is the point. The slot is CLAIMED in the database before Omise is
 * called, so a double-click, or two admins on two machines, produce one
 * transfer and one refusal rather than two transfers — the same shape as
 * reserveAttempt in lib/payments.ts, and backed by the same kind of partial
 * unique index underneath.
 *
 * A row that settled before this feature existed has no `transferFee` and a
 * commission worked out without one. It is REBUILT here from `net` rather than
 * paid as it stands, because paying it as it stands would hand Omise's fee to
 * the seller to absorb — the one party who never agreed to it.
 */
export async function approvePayout(params: {
  paymentId: string;
  adminId: string;
}): Promise<ApprovePayoutResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      id: true,
      status: true,
      net: true,
      commission: true,
      sellerNet: true,
      transferFee: true,
      transferStatus: true,
      auctionItem: {
        select: {
          title: true,
          sellerId: true,
          seller: {
            select: {
              bankAccount: {
                select: {
                  omiseRecipientId: true,
                  recipientStatus: true,
                  accountNumber: true,
                  accountName: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.status !== "successful" || payment.net === null) {
    return { ok: false, reason: "not_settled" };
  }
  if (payment.transferStatus !== null && payment.transferStatus !== "failed") {
    return { ok: false, reason: "already_transferred" };
  }

  const account = payment.auctionItem.seller.bankAccount;
  if (!account) return { ok: false, reason: "no_bank_account" };
  if (!account.omiseRecipientId || account.recipientStatus !== "verified") {
    return { ok: false, reason: "recipient_not_ready" };
  }

  const planned = planPayout(payment.net);
  if (!planned.ok) return { ok: false, reason: "below_minimum" };
  const plan = planned.plan;

  // Claim the slot. `transferStatus` moving off null (or off 'failed', for a
  // retry) is what makes this the one attempt in flight; the partial unique
  // index on the auction is what catches the case two connections both get here.
  let claimed: number;
  try {
    ({ count: claimed } = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        OR: [{ transferStatus: null }, { transferStatus: "failed" }],
      },
      data: {
        transferStatus: "pending",
        transferAmount: plan.transferAmount,
        transferFee: plan.transferFee,
        commission: plan.commission,
        sellerNet: plan.sellerNet,
        transferFailureCode: null,
        transferFailureMessage: null,
      },
    }));
  } catch (error) {
    // The unique index fired: another auction row already holds a live
    // transfer for this sale.
    console.error("[payouts] claim refused:", error);
    return { ok: false, reason: "already_transferred" };
  }
  if (claimed === 0) return { ok: false, reason: "already_transferred" };

  let transfer: OmiseTransfer;
  try {
    transfer = await createTransfer({
      amountSatang: plan.transferAmount,
      recipientId: account.omiseRecipientId,
      metadata: { paymentId: payment.id, kind: "payout" },
    });
  } catch (error) {
    const detail =
      error instanceof OmiseApiError ? `${error.code}: ${error.message}` : String(error);
    // Released to 'failed', not to null: the row goes back in the queue and can
    // be approved again, but the reason stays on it. If the call actually did
    // create a transfer before failing, the sweep adopts it from metadata —
    // which is the only reason the metadata is there.
    await markTransferFailed(payment.id, codeOf(error), detail);
    return { ok: false, reason: "gateway_error", detail };
  }

  // Creation is not sending. An inactive recipient or a balance that will not
  // cover it both come back HTTP 200 with sendable: false, and the transfer
  // would sit at Omise forever. Verified against the TEST API.
  if (!transfer.sendable) {
    await markTransferFailed(
      payment.id,
      "not_sendable",
      "Omise รับรายการแล้วแต่จะไม่ส่ง — ตรวจสอบยอดคงเหลือหรือสถานะบัญชีผู้รับ",
      transfer.id,
    );
    return { ok: false, reason: "transfer_refused", detail: transfer.id };
  }

  await recordTransferResult(payment.id, transfer, {
    adminId: params.adminId,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    chargeNet: payment.net,
  });

  if (transfer.sent) {
    await announcePayout(payment.id);
  }

  return {
    ok: true,
    transferId: transfer.id,
    sellerNet: transfer.net,
    transferFee: transfer.total_fee,
  };
}

/**
 * Write down what Omise actually did, and make the arithmetic agree with it.
 *
 * The predicted fee comes from a tier table (lib/payout-math.ts) because the
 * commission cannot be worked out without one and Omise quotes no fee until a
 * transfer exists. When the prediction is wrong the RESPONSE wins: `net` from
 * the transfer is what the seller receives, `total_fee` is what it cost, and
 * the commission is re-derived as "what was not sent" —
 *
 *     commission = chargeNet - transfer.amount
 *
 * so commission + sellerNet + transferFee === chargeNet holds by construction
 * whatever Omise charges. A mispriced tier then costs one payout's worth of
 * drift in the platform's favour or the seller's, is logged loudly, and is
 * fixed by correcting the table rather than by reconciling books later.
 */
async function recordTransferResult(
  paymentId: string,
  transfer: OmiseTransfer,
  context: {
    adminId: string;
    accountNumber: string;
    accountName: string;
    chargeNet: number;
  },
): Promise<void> {
  const commission = context.chargeNet - transfer.amount;

  if (transfer.total_fee + transfer.net !== transfer.amount) {
    console.error(
      "[payouts] transfer does not balance:",
      transfer.id,
      transfer.amount,
      transfer.total_fee,
      transfer.net,
    );
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      omiseTransferId: transfer.id,
      transferStatus: transfer.paid ? "paid" : transfer.sent ? "sent" : "pending",
      transferAmount: transfer.amount,
      transferFee: transfer.total_fee,
      transferNet: transfer.net,
      transferSentAt: transfer.sent_at ? new Date(transfer.sent_at) : null,
      transferPaidAt: transfer.paid_at ? new Date(transfer.paid_at) : null,
      transferFailureCode: transfer.failure_code,
      transferFailureMessage: transfer.failure_message,
      // The real figures, so the payout statement and the bank agree.
      commission,
      sellerNet: transfer.net,
      // The manual-payout columns keep their meaning: the queue filters on
      // payoutStatus, and the transfer id IS the reference now.
      payoutStatus: "transferred",
      payoutAt: new Date(),
      payoutById: context.adminId,
      payoutReference: transfer.id,
      payoutAccountNumber: context.accountNumber,
      payoutAccountName: context.accountName,
    },
  });
}

/** Put a payment back in the queue with the reason it did not go. */
async function markTransferFailed(
  paymentId: string,
  code: string | null,
  message: string,
  transferId?: string,
): Promise<void> {
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      transferStatus: "failed",
      transferFailureCode: code,
      transferFailureMessage: message,
      ...(transferId ? { omiseTransferId: transferId } : {}),
    },
  });
}

/**
 * Poll the transfers that have not landed, and adopt any that were orphaned.
 *
 * `pending` and `sent` are both re-read: Omise sends on its own schedule, and
 * "sent" only becomes "paid" when the receiving bank says so. A transfer that
 * comes back failed goes back in the queue with its reason, because the money
 * did not move and somebody has to try again.
 */
export async function reconcileTransfers(limit = 100): Promise<{
  checked: number;
  sent: number;
  paid: number;
  failed: number;
  adopted: number;
}> {
  const live = await prisma.payment.findMany({
    where: {
      transferStatus: { in: ["pending", "sent"] },
      omiseTransferId: { not: null },
    },
    orderBy: { payoutAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, omiseTransferId: true, transferStatus: true, net: true },
  });

  let sent = 0;
  let paid = 0;
  let failed = 0;

  for (const row of live) {
    if (!row.omiseTransferId) continue;

    let transfer: OmiseTransfer;
    try {
      transfer = await retrieveTransfer(row.omiseTransferId);
    } catch (error) {
      console.error("[payouts] retrieveTransfer failed:", row.omiseTransferId, error);
      continue;
    }

    const status = transfer.failure_code
      ? "failed"
      : transfer.paid
        ? "paid"
        : transfer.sent
          ? "sent"
          : "pending";

    if (status === row.transferStatus) continue;

    await prisma.payment.update({
      where: { id: row.id },
      data: {
        transferStatus: status,
        transferSentAt: transfer.sent_at ? new Date(transfer.sent_at) : null,
        transferPaidAt: transfer.paid_at ? new Date(transfer.paid_at) : null,
        transferNet: transfer.net,
        transferFailureCode: transfer.failure_code,
        transferFailureMessage: transfer.failure_message,
        // A transfer the bank sent back is money that never left. It has to
        // look un-paid-out again or it will never be retried.
        ...(status === "failed" ? { payoutStatus: "pending" as const } : {}),
      },
    });

    if (status === "sent") {
      sent++;
      await announcePayout(row.id);
    } else if (status === "paid") {
      paid++;
      await announcePayout(row.id);
    } else if (status === "failed") {
      failed++;
    }
  }

  const adopted = await adoptOrphanedTransfers();
  return { checked: live.length, sent, paid, failed, adopted };
}

/**
 * Recover transfers that exist at Omise but were never written down.
 *
 * The one gap a two-step "create it, then record it" cannot close on its own:
 * a crash in between leaves real money moving with no local row. Every transfer
 * carries its payment id in metadata, so it can be found and adopted. The
 * charge sweep in lib/payments.ts closes the same gap the same way.
 */
async function adoptOrphanedTransfers(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let recent: { data: OmiseTransfer[] };
  try {
    recent = await listTransfers({ from: since, to: new Date(), limit: 100 });
  } catch (error) {
    console.error("[payouts] listTransfers failed:", error);
    return 0;
  }

  let adopted = 0;
  for (const transfer of recent.data) {
    const paymentId = transfer.metadata?.paymentId;
    if (!paymentId || transfer.deleted) continue;

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, omiseTransferId: null },
      select: { id: true, net: true, payoutById: true },
    });
    if (!payment || payment.net === null) continue;

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        omiseTransferId: transfer.id,
        transferStatus: transfer.failure_code
          ? "failed"
          : transfer.paid
            ? "paid"
            : transfer.sent
              ? "sent"
              : "pending",
        transferAmount: transfer.amount,
        transferFee: transfer.total_fee,
        transferNet: transfer.net,
        commission: payment.net - transfer.amount,
        sellerNet: transfer.net,
        transferSentAt: transfer.sent_at ? new Date(transfer.sent_at) : null,
        transferPaidAt: transfer.paid_at ? new Date(transfer.paid_at) : null,
        transferFailureCode: transfer.failure_code,
        transferFailureMessage: transfer.failure_message,
        payoutStatus: transfer.failure_code ? "pending" : "transferred",
        payoutReference: transfer.id,
      },
    });
    adopted++;
  }

  return adopted;
}

/** Tell the seller the money is on its way. Deduped on the payment id. */
async function announcePayout(paymentId: string): Promise<void> {
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      transferNet: true,
      sellerNet: true,
      auctionItem: { select: { title: true, sellerId: true } },
    },
  });
  if (!row) return;

  await notifyPayoutSent({
    paymentId,
    itemTitle: row.auctionItem.title,
    sellerId: row.auctionItem.sellerId,
    amount: row.transferNet ?? row.sellerNet ?? 0,
  });
}

function codeOf(error: unknown): string | null {
  return error instanceof OmiseApiError ? error.code : null;
}
