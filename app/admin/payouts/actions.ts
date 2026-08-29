"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin";
import { formatBaht } from "@/lib/money";
import {
  approvePayout,
  recipientPayoutsEnabled,
  type ApprovePayoutFailure,
} from "@/lib/payouts";
import { prisma } from "@/lib/prisma";

export type PayoutActionState = {
  ok: boolean;
  message: string | null;
};

/**
 * Record that a seller has been paid.
 *
 * The transfer itself happens in the admin's banking app; this only writes
 * down that it happened, so the entry is an audit record and nothing else.
 * Three things make it trustworthy:
 *
 *   - it is guarded on payoutStatus as well as id, so two admins clicking at
 *     once cannot both record a transfer;
 *   - a bank reference is required, so every entry can be traced back to a
 *     real transaction;
 *   - the account paid is SNAPSHOTTED here. The seller can change their bank
 *     details later, and what was actually paid must not change with them.
 */
export async function markPaidOutAction(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const admin = await requireAdmin("/admin/payouts");

  const paymentId = String(formData.get("paymentId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();

  if (!reference) {
    return { ok: false, message: "กรุณากรอกเลขอ้างอิงการโอน" };
  }
  if (reference.length > 100) {
    return { ok: false, message: "เลขอ้างอิงยาวเกินไป" };
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, status: "successful", payoutStatus: "pending" },
    select: {
      id: true,
      auctionItem: {
        select: { seller: { select: { bankAccount: true } } },
      },
    },
  });
  if (!payment) {
    return { ok: false, message: "ไม่พบรายการนี้ หรือถูกโอนไปแล้ว" };
  }

  const account = payment.auctionItem.seller.bankAccount;
  if (!account) {
    return { ok: false, message: "ผู้ขายยังไม่ได้บันทึกบัญชีธนาคาร" };
  }

  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, payoutStatus: "pending" },
    data: {
      payoutStatus: "transferred",
      payoutAt: new Date(),
      payoutById: admin.user.id,
      payoutReference: reference,
      payoutAccountNumber: account.accountNumber,
      payoutAccountName: account.accountName,
    },
  });

  if (count === 0) {
    return { ok: false, message: "รายการนี้ถูกบันทึกไปแล้ว" };
  }

  revalidatePath("/admin/payouts");
  return { ok: true, message: "บันทึกการโอนเรียบร้อยแล้ว" };
}

/**
 * Approve one payout and send it — the whole of the automatic flow's button.
 *
 * Deliberately thin. Every decision worth reviewing (is the recipient ready,
 * how much moves, who wins a double click) lives in lib/payouts.ts, where it
 * can be tested without a browser; this only turns an admin's click into that
 * call and its answer into a sentence.
 *
 * There is no reference field. Under the manual flow the admin typed the bank's
 * reference in because only they had it; here the transfer id IS the reference,
 * and asking a human to copy one out of an API response would be inviting a
 * typo into a financial record.
 */
export async function approvePayoutAction(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const admin = await requireAdmin("/admin/payouts");

  if (!recipientPayoutsEnabled()) {
    return { ok: false, message: "ระบบโอนอัตโนมัติปิดอยู่" };
  }

  const result = await approvePayout({
    paymentId: String(formData.get("paymentId") ?? ""),
    adminId: admin.user.id,
  });

  if (result.ok) {
    revalidatePath("/admin/payouts");
    return {
      ok: true,
      message: `โอนแล้ว ${formatBaht(result.sellerNet)} (ค่าธรรมเนียมโอน ${formatBaht(result.transferFee)})`,
    };
  }

  revalidatePath("/admin/payouts");
  return { ok: false, message: PAYOUT_FAILURE_MESSAGE[result.reason] };
}

/**
 * One line each, in the admin's language, saying what to do next.
 *
 * `gateway_error` and `transfer_refused` are separate because the next step
 * differs: the first is worth pressing again, the second means something about
 * the account or the balance has to change first.
 */
const PAYOUT_FAILURE_MESSAGE: Record<ApprovePayoutFailure, string> = {
  not_found: "ไม่พบรายการนี้",
  not_settled: "รายการนี้ยังไม่มีเงินเข้า",
  already_transferred: "รายการนี้ถูกโอนไปแล้ว",
  no_bank_account: "ผู้ขายยังไม่ได้บันทึกบัญชีธนาคาร",
  recipient_not_ready: "รอผู้ขายยืนยันบัญชีธนาคาร",
  below_minimum: "ยอดน้อยเกินกว่าจะโอนได้ — ต้องโอนด้วยมือ",
  transfer_refused: "Omise ไม่ส่งรายการนี้ — ตรวจสอบยอดคงเหลือหรือบัญชีผู้รับ",
  gateway_error: "เชื่อมต่อ Omise ไม่สำเร็จ กดอนุมัติใหม่ได้",
};
