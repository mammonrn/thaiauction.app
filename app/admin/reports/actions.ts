"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin";
import { endAuctionBySeller } from "@/lib/bidding";
import {
  deleteItem,
  dismissReports,
  type DeleteItemFailure,
} from "@/lib/moderation";
import {
  issueBan,
  liftBan,
  type BanDuration,
  type BanKind,
} from "@/lib/bans";
import { prisma } from "@/lib/prisma";

export type AdminActionState = {
  ok: boolean;
  message: string | null;
};

const DELETE_FAILURES: Record<DeleteItemFailure, string> = {
  not_found: "ไม่พบรายการนี้",
  already_deleted: "รายการนี้ถูกลบไปแล้ว",
  awaiting_payment:
    "รายการนี้มีผู้ชนะที่รอชำระเงินอยู่ — ต้องปิดการประมูลก่อนจึงจะลบได้",
  no_reason: "กรุณากรอกเหตุผล",
};

/** Take a reported listing down. */
export async function deleteItemAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdmin("/admin/reports");
  const itemId = String(formData.get("itemId") ?? "");

  const result = await deleteItem({
    itemId,
    adminId: session.user.id,
    reason: String(formData.get("reason") ?? ""),
  });

  revalidatePath("/admin/reports");
  revalidatePath(`/auctions/${itemId}`);

  return result.ok
    ? { ok: true, message: "ลบรายการแล้ว" }
    : { ok: false, message: DELETE_FAILURES[result.reason] };
}

/**
 * Close a reported auction that still owes somebody an item, so it can then be
 * removed.
 *
 * Uses `endAuctionBySeller` — the seller's own end-early mechanism, called
 * with the seller's id, so it settles under the auction's row lock exactly as
 * it does when the seller presses the button. Nothing about the settlement
 * rules is re-implemented here, and lib/bidding.ts is not modified: this is an
 * existing exported function being called.
 *
 * Deliberately a SEPARATE press from removing. Closing an auction decides who
 * won and what they owe; folding that into a delete button would hide a
 * settlement inside what looks like a tidy-up.
 */
export async function closeItemAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdmin("/admin/reports");
  const itemId = String(formData.get("itemId") ?? "");

  const item = await prisma.auctionItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true },
  });
  if (!item) return { ok: false, message: "ไม่พบรายการนี้" };
  if (item.status !== "active") {
    return { ok: false, message: "การประมูลนี้ปิดไปแล้ว" };
  }

  const result = await endAuctionBySeller(itemId, item.sellerId);
  revalidatePath("/admin/reports");
  revalidatePath(`/auctions/${itemId}`);

  if (!result.ok) return { ok: false, message: "ปิดการประมูลไม่สำเร็จ" };

  return {
    ok: true,
    message: result.winnerId
      ? "ปิดการประมูลแล้ว — มีผู้ชนะที่ต้องชำระเงิน จึงยังลบไม่ได้จนกว่าจะจบเรื่องเงิน"
      : "ปิดการประมูลแล้ว (ไม่มีผู้ชนะ) — ลบได้เลย",
  };
}

/** Reject the open reports on a listing and leave it up. */
export async function dismissReportsAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdmin("/admin/reports");
  const itemId = String(formData.get("itemId") ?? "");

  const result = await dismissReports(itemId, session.user.id);
  revalidatePath("/admin/reports");

  return result.ok
    ? { ok: true, message: "ปิดเรื่องแล้ว" }
    : { ok: false, message: "ไม่มีเรื่องที่เปิดอยู่" };
}

const BAN_FAILURES: Record<string, string> = {
  not_found: "ไม่พบบัญชีนี้",
  no_reason: "กรุณากรอกเหตุผล",
  self: "แบนบัญชีตัวเองไม่ได้",
};

/** Ban an account, for a fixed number of days or permanently. */
export async function banUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdmin("/admin/reports");

  const rawDuration = String(formData.get("duration") ?? "");
  const duration: BanDuration =
    rawDuration === "permanent" ? "permanent" : (Number(rawDuration) as 1 | 3 | 7 | 30);

  const result = await issueBan({
    userId: String(formData.get("userId") ?? ""),
    kind: String(formData.get("kind") ?? "bidding") === "login" ? "login" : "bidding",
    reason: String(formData.get("reason") ?? ""),
    duration,
    bannedById: session.user.id,
  });

  revalidatePath("/admin/reports");
  revalidatePath("/admin/users");

  return result.ok
    ? { ok: true, message: "แบนบัญชีแล้ว" }
    : { ok: false, message: BAN_FAILURES[result.reason] ?? "แบนไม่สำเร็จ" };
}

/** End a ban before its expiry. */
export async function liftBanAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdmin("/admin/reports");

  const result = await liftBan(String(formData.get("banId") ?? ""));
  revalidatePath("/admin/reports");
  revalidatePath("/admin/users");

  return result.ok
    ? { ok: true, message: "ปลดแบนแล้ว" }
    : { ok: false, message: "ไม่พบการแบนที่ยังมีผลอยู่" };
}

/** Only for the kind check above; keeps the union honest at the call site. */
export type { BanKind };
