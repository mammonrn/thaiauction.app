"use server";

import { revalidatePath } from "next/cache";

import {
  openSecondChance,
  type OfferResult,
} from "@/lib/failed-deal";
import { notifySecondChanceOffered } from "@/lib/notifications";
import { requireSession } from "@/lib/session";

export type DealActionState = {
  ok: boolean;
  message: string | null;
};

const FAILURES: Record<Exclude<OfferResult, { ok: true }>["reason"], string> = {
  // "Not yours" and "does not exist" read the same, as everywhere else
  // something is addressable by a guessable id.
  not_found: "ไม่พบรายการนี้",
  not_failed: "รายการนี้ไม่ได้อยู่ในสถานะรอตัดสินใจแล้ว",
  offer_live: "มีข้อเสนอที่ยังรอคำตอบอยู่แล้ว",
  no_candidate: "ไม่มีผู้เสนอราคารายอื่นที่เสนอให้ได้",
};

/**
 * Offer a failed deal to the next eligible bidder.
 *
 * The seller asks for this — nothing offers anything on its own. The bidder is
 * chosen on the server and never named to the seller: they are shown the price
 * and nothing else.
 */
export async function offerSecondChanceAction(
  _prev: DealActionState,
  formData: FormData,
): Promise<DealActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const itemTitle = String(formData.get("itemTitle") ?? "");
  const { user } = await requireSession("/sell");

  const result = await openSecondChance(itemId, user.id);

  if (result.ok) {
    // Wrapped: the offer is written and stands whether or not the bell rings.
    // Same trade lib/notifications.ts makes everywhere else.
    try {
      await notifySecondChanceOffered({
        offerId: result.offerId,
        itemTitle,
        bidderId: result.bidderId,
        amount: result.amount,
      });
    } catch (error) {
      console.error("[second-chance] offer notification failed:", error);
    }
  }

  revalidatePath("/sell");

  return result.ok
    ? { ok: true, message: "ส่งข้อเสนอแล้ว รอคำตอบภายใน 24 ชั่วโมง" }
    : { ok: false, message: FAILURES[result.reason] };
}
