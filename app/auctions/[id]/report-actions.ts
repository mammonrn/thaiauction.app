"use server";

import { revalidatePath } from "next/cache";

import { MAX_REPORT_NOTE, reportItem, type ReportFailure } from "@/lib/moderation";
import { requireSession } from "@/lib/session";

export type ReportActionState = {
  ok: boolean;
  message: string | null;
};

const FAILURES: Record<ReportFailure, string> = {
  not_found: "ไม่พบรายการนี้",
  own_item: "แจ้งสินค้าของตัวเองไม่ได้",
  invalid_reason: "กรุณาเลือกเหตุผล",
  note_too_long: `รายละเอียดต้องไม่เกิน ${MAX_REPORT_NOTE} ตัวอักษร`,
};

/**
 * Report a listing.
 *
 * `requireSession` first, so a signed-out visitor is sent to log in rather
 * than being told what happened — there is no anonymous reporting, because a
 * report with nobody attached is not something an admin can weigh.
 */
export async function reportItemAction(
  _prev: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const { user } = await requireSession(`/auctions/${itemId}`);

  const result = await reportItem({
    itemId,
    reporterId: user.id,
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  revalidatePath(`/auctions/${itemId}`);

  if (!result.ok) {
    return { ok: false, message: FAILURES[result.reason] };
  }

  // The same words either way. Telling a repeat reporter their earlier report
  // is already on file invites them to try again another way; telling them it
  // was received is true, and true the second time too.
  return { ok: true, message: "รับเรื่องแล้ว ทีมงานจะตรวจสอบ" };
}
