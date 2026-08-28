"use server";

import { revalidatePath } from "next/cache";

import { bahtToSatang, formatBaht } from "@/lib/money";
import { endAuctionBySeller, placeBid } from "@/lib/bidding";
import { prisma } from "@/lib/prisma";
import { requestOrigin } from "@/lib/request-origin";
import { requireSession } from "@/lib/session";
import { shillMessage } from "@/lib/anti-shill";
import { banMessage } from "@/lib/strikes";

export type BidActionState = {
  ok: boolean;
  message: string | null;
};

/**
 * Place a bid.
 *
 * A verified phone is required for the same reason it is required to sell: a
 * bid is a commitment to pay, and the seller has to be able to reach the
 * winner. Everything about whether the bid is legal — price, status, timing,
 * ownership — is decided inside the locked transaction in lib/bidding.ts, not
 * here, so it cannot be decided on a stale read.
 */
export async function placeBidAction(
  _prev: BidActionState,
  formData: FormData,
): Promise<BidActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const { user } = await requireSession(`/auctions/${itemId}`);

  const verified = await prisma.verifiedPhone.count({
    where: { userId: user.id },
  });
  if (verified === 0) {
    return {
      ok: false,
      message: "กรุณายืนยันเบอร์โทรศัพท์ก่อนเสนอราคา (ไปที่ บัญชีของฉัน > เบอร์โทรศัพท์)",
    };
  }

  const raw = String(formData.get("amount") ?? "").trim();
  const baht = Number(raw);
  if (!raw || !Number.isFinite(baht) || baht <= 0) {
    return { ok: false, message: "กรุณากรอกจำนวนเงินให้ถูกต้อง" };
  }

  let result;
  try {
    result = await placeBid(
      itemId,
      user.id,
      bahtToSatang(baht),
      await requestOrigin(),
    );
  } catch (error) {
    console.error("[bid] failed:", error);
    return { ok: false, message: "เสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "ไม่พบรายการนี้",
      not_active: "การประมูลนี้ปิดแล้ว",
      expired: "หมดเวลาประมูลแล้ว",
      own_item: "ผู้ขายเสนอราคาสินค้าของตัวเองไม่ได้",
      already_leading: "คุณเป็นผู้เสนอราคาสูงสุดอยู่แล้ว",
      not_an_amount: "จำนวนเงินไม่ถูกต้อง",
      above_buy_now:
        result.buyNowPrice != null
          ? `เสนอเกินราคาซื้อทันทีไม่ได้ — เสนอ ${formatBaht(result.buyNowPrice)} เพื่อปิดการประมูลทันที`
          : "จำนวนเงินไม่ถูกต้อง",
      below_minimum:
        result.minimum != null
          ? `ต้องเสนออย่างน้อย ${formatBaht(result.minimum)}`
          : "จำนวนเงินต่ำเกินไป",
    };

    // These two carry their own explanation, built from why the bid was
    // refused: a banned bidder is told how many strikes and that everything
    // except bidding still works, and a suspected shill is told which signal
    // matched, so neither is left guessing.
    const explained =
      result.reason === "banned"
        ? banMessage(result.strikes ?? 0)
        : result.reason === "shill" && result.shillLink
          ? shillMessage(result.shillLink)
          : null;

    revalidatePath(`/auctions/${itemId}`);
    return {
      ok: false,
      message: explained ?? messages[result.reason] ?? "เสนอราคาไม่สำเร็จ",
    };
  }

  revalidatePath(`/auctions/${itemId}`);
  return {
    ok: true,
    message: result.wonByBuyNow
      ? `ซื้อทันทีสำเร็จ! คุณชนะการประมูลที่ ${formatBaht(result.amount)}`
      : `เสนอราคา ${formatBaht(result.amount)} เรียบร้อยแล้ว`,
  };
}

/**
 * Seller closes their own auction early.
 *
 * Ownership is enforced inside the locked transaction, so another user cannot
 * end someone else's auction by submitting its id.
 */
export async function endAuctionAction(
  _prev: BidActionState,
  formData: FormData,
): Promise<BidActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const { user } = await requireSession("/sell");

  let result;
  try {
    result = await endAuctionBySeller(itemId, user.id);
  } catch (error) {
    console.error("[end-auction] failed:", error);
    return { ok: false, message: "จบการประมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "not_active"
          ? "การประมูลนี้ปิดไปแล้ว"
          : "ไม่พบรายการนี้",
    };
  }

  revalidatePath(`/auctions/${itemId}`);
  revalidatePath("/sell");

  return {
    ok: true,
    message: result.winnerId
      ? "จบการประมูลแล้ว ผู้เสนอราคาสูงสุดเป็นผู้ชนะ"
      : "ยกเลิกรายการแล้ว (ยังไม่มีผู้เสนอราคา จึงไม่มีผู้ชนะ)",
  };
}
