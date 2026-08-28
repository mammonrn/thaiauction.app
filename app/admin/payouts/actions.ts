"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin";
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
