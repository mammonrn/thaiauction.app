"use server";

import { revalidatePath } from "next/cache";

import { deleteKycDocument } from "@/lib/kyc-storage";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export type WithdrawState = {
  ok: boolean;
  message: string | null;
};

/**
 * Withdraw a pending request and erase the document.
 *
 * Someone who changes their mind before review should not have to wait for an
 * admin to look at their ID card first. Scoped to the caller's own pending row,
 * so another user's submission can never be touched.
 */
export async function withdrawVerificationAction(
  _prev: WithdrawState,
): Promise<WithdrawState> {
  const { user } = await requireSession("/account/verification");

  const pending = await prisma.sellerVerification.findFirst({
    where: { userId: user.id, status: "pending" },
    select: { id: true, documentKey: true },
  });
  if (!pending) {
    return { ok: false, message: "ไม่มีคำขอที่รอตรวจสอบ" };
  }

  await prisma.sellerVerification.deleteMany({
    where: { id: pending.id, userId: user.id, status: "pending" },
  });
  await deleteKycDocument(pending.documentKey);

  revalidatePath("/account/verification");
  return { ok: true, message: "ยกเลิกคำขอและลบรูปเรียบร้อยแล้ว" };
}
