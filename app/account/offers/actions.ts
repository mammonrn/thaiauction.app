"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptSecondChance,
  declineSecondChance,
  type RespondResult,
} from "@/lib/failed-deal";
import { notifySecondChanceClosed } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export type OfferActionState = {
  ok: boolean;
  message: string | null;
};

const FAILURES: Record<Exclude<RespondResult, { ok: true }>["reason"], string> = {
  not_found: "ไม่พบข้อเสนอนี้",
  // Said plainly rather than as a 404: the person is signed in, and this is
  // simply not their answer to give.
  not_yours: "ข้อเสนอนี้ไม่ได้เสนอให้คุณ",
  closed: "ข้อเสนอนี้ปิดไปแล้ว",
  expired: "ข้อเสนอนี้หมดอายุแล้ว",
};

/**
 * Take the offer.
 *
 * From here it is an ordinary win: the item gets a winner, the price they bid
 * and a 24-hour deadline, and the existing payment flow does the rest —
 * including striking this person if they now fail to pay, through the same
 * sweep that strikes everybody else.
 */
export async function acceptOfferAction(
  _prev: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const offerId = String(formData.get("offerId") ?? "");
  const { user } = await requireSession("/account/offers");

  const result = await acceptSecondChance(offerId, user.id);

  revalidatePath("/account/offers");
  revalidatePath("/account/bids");
  revalidatePath("/sell");

  if (!result.ok) return { ok: false, message: FAILURES[result.reason] };

  // Straight to the payment. The offer has just left this page's list — it is
  // no longer `offered` — so a success message here would be rendered by a card
  // that no longer exists, and the person would be left holding a 24-hour
  // deadline with nothing on screen telling them so.
  redirect(`/auctions/${result.itemId}/pay`);
}

/**
 * Turn it down.
 *
 * Free, and said so on the button. The seller is told so the item goes back to
 * being their decision rather than sitting on a silent refusal.
 */
export async function declineOfferAction(
  _prev: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const offerId = String(formData.get("offerId") ?? "");
  const { user } = await requireSession("/account/offers");

  const result = await declineSecondChance(offerId, user.id);

  if (result.ok) {
    try {
      const item = await prisma.auctionItem.findUnique({
        where: { id: result.itemId },
        select: { title: true, sellerId: true },
      });
      if (item) {
        await notifySecondChanceClosed({
          offerId,
          itemTitle: item.title,
          sellerId: item.sellerId,
          outcome: "declined",
        });
      }
    } catch (error) {
      console.error("[second-chance] decline notification failed:", error);
    }
  }

  revalidatePath("/account/offers");
  revalidatePath("/sell");

  return result.ok
    ? { ok: true, message: "ปฏิเสธข้อเสนอแล้ว" }
    : { ok: false, message: FAILURES[result.reason] };
}
