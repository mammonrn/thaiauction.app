"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin";
import { deleteKycDocument } from "@/lib/kyc-storage";
import { prisma } from "@/lib/prisma";

export type ReviewActionState = {
  ok: boolean;
  message: string | null;
};

/**
 * Record a decision and erase the document.
 *
 * The retention rule: the ID image exists only while a human needs it to
 * decide. The moment the decision is recorded the file is deleted and
 * documentKey is cleared, whichever way the decision went. What remains is the
 * audit trail — who decided, when, and the reason for a refusal.
 *
 * The database write and the file deletion are ordered so the row can never
 * still point at a file that is gone in a way that matters: documentKey is
 * cleared first, so the serving route stops resolving it even if the unlink
 * fails, and a leftover file on disk is unreachable.
 */
async function decide(
  formData: FormData,
  status: "approved" | "rejected",
  rejectionReason: string | null,
): Promise<ReviewActionState> {
  const admin = await requireAdmin("/admin/verifications");
  const id = String(formData.get("verificationId") ?? "");

  const pending = await prisma.sellerVerification.findFirst({
    where: { id, status: "pending" },
    select: { id: true, documentKey: true },
  });
  if (!pending) {
    return { ok: false, message: "ไม่พบคำขอนี้ หรือถูกตรวจสอบไปแล้ว" };
  }

  try {
    // Guarded on status as well as id, so two admins clicking at once cannot
    // both record a decision.
    const { count } = await prisma.sellerVerification.updateMany({
      where: { id: pending.id, status: "pending" },
      data: {
        status,
        rejectionReason,
        reviewedAt: new Date(),
        reviewedById: admin.user.id,
        documentKey: null,
        documentDeletedAt: new Date(),
      },
    });

    if (count === 0) {
      return { ok: false, message: "คำขอนี้ถูกตรวจสอบไปแล้ว" };
    }

    await deleteKycDocument(pending.documentKey);
  } catch {
    // Deliberately logged without the row or the key: nothing that identifies
    // whose document this was should reach the logs.
    console.error("[kyc] review failed");
    return { ok: false, message: "บันทึกผลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/admin/verifications");
  revalidatePath("/account/verification");

  return {
    ok: true,
    message: status === "approved" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว",
  };
}

export async function approveVerificationAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  return decide(formData, "approved", null);
}

export async function rejectVerificationAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { ok: false, message: "กรุณาระบุเหตุผลที่ปฏิเสธ" };
  }
  if (reason.length > 500) {
    return { ok: false, message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร" };
  }
  return decide(formData, "rejected", reason);
}
