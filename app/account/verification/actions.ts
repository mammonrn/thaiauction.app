"use server";

import { revalidatePath } from "next/cache";

import { validateIdentity, type IdentityErrors } from "@/lib/identity";
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


export type IdentityActionState = {
  ok: boolean;
  message: string | null;
  errors?: IdentityErrors;
  values?: Record<string, string>;
};

/**
 * Whether a user may still change their legal identity.
 *
 * Locked once a request is pending or approved. Approved is obvious — a
 * reviewer matched exactly these details against a card, and letting them be
 * rewritten afterwards would make the approval meaningless. Pending matters for
 * the same reason: an admin is looking at that data right now, and it must not
 * change underneath them mid-review.
 */
export async function canEditIdentity(userId: string): Promise<boolean> {
  const blocking = await prisma.sellerVerification.count({
    where: { userId, status: { in: ["pending", "approved"] } },
  });
  return blocking === 0;
}

/**
 * Save the seller's legal name and date of birth.
 *
 * The 18+ rule lives here, in the seller path only. Buyers never reach this
 * action, so browsing, bidding and winning stay open to any account — the age
 * requirement is about who may sell, not who may use the site.
 */
export async function saveIdentityAction(
  _prev: IdentityActionState,
  formData: FormData,
): Promise<IdentityActionState> {
  const { user } = await requireSession("/account/verification");

  const submitted = {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
  };

  // Re-checked server-side: the form hides itself when locked, but a stale tab
  // could still post.
  if (!(await canEditIdentity(user.id))) {
    return {
      ok: false,
      message: "แก้ไขข้อมูลไม่ได้ระหว่างรอตรวจสอบหรือหลังยืนยันแล้ว",
      values: submitted,
    };
  }

  const parsed = validateIdentity(submitted);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "กรุณาตรวจสอบข้อมูลที่กรอก",
      errors: parsed.errors,
      values: submitted,
    };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: parsed.value.firstName,
        lastName: parsed.value.lastName,
        dateOfBirth: parsed.value.dateOfBirth,
      },
    });
  } catch {
    console.error("[kyc] saving identity failed");
    return { ok: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", values: submitted };
  }

  revalidatePath("/account/verification");
  return { ok: true, message: "บันทึกข้อมูลเรียบร้อยแล้ว" };
}
