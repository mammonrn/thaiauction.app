"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { bahtToSatang, formatBaht } from "@/lib/money";
import { buyNow, endAuctionBySeller, placeBid } from "@/lib/bidding";
import { prisma } from "@/lib/prisma";
import { requestOrigin } from "@/lib/request-origin";
import { requireSession } from "@/lib/session";
import { shillMessage } from "@/lib/anti-shill";
import { banMessage } from "@/lib/strikes";
import { banMessageFor, biddingBan } from "@/lib/bans";

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
      // The page offers a dialog for this; someone reaching here has a stale
      // tab, so the fix is to reload rather than to navigate somewhere else.
      message: "กรุณายืนยันเบอร์โทรศัพท์ก่อนเสนอราคา — โหลดหน้านี้ใหม่แล้วกดปุ่มยืนยันเบอร์โทร",
    };
  }

  // An admin's ban, checked here rather than in lib/bidding.ts. It is a
  // separate system from strikes — a human decision with an end date, not an
  // automatic count — and the strike logic stays exactly as it was.
  const ban = await biddingBan(user.id);
  if (ban) return { ok: false, message: banMessageFor(ban) };

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
 * Buy the item outright.
 *
 * Deliberately takes no amount: the price is read from the locked auction row
 * inside lib/bidding.ts, so a tab left open since before the seller changed the
 * price cannot buy at the old one. The same phone check as bidding applies —
 * buying outright is a commitment to pay, and the seller has to be able to
 * reach the buyer.
 */
export async function buyNowAction(
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
      message: "กรุณายืนยันเบอร์โทรศัพท์ก่อนซื้อ — โหลดหน้านี้ใหม่แล้วกดปุ่มยืนยันเบอร์โทร",
    };
  }

  const ban = await biddingBan(user.id);
  if (ban) return { ok: false, message: banMessageFor(ban) };

  let result;
  try {
    result = await buyNow(itemId, user.id, await requestOrigin());
  } catch (error) {
    console.error("[buy-now] failed:", error);
    return { ok: false, message: "ซื้อทันทีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "ไม่พบรายการนี้",
      // Someone else got there first, or the clock ran out mid-click. Both are
      // "it is over", and the page refreshes itself to show who won.
      not_active: "การประมูลนี้ปิดแล้ว",
      expired: "หมดเวลาประมูลแล้ว",
      own_item: "ผู้ขายซื้อสินค้าของตัวเองไม่ได้",
      no_buy_now: "รายการนี้ไม่มีราคาซื้อทันที",
    };

    const explained =
      result.reason === "banned"
        ? banMessage(result.strikes ?? 0)
        : result.reason === "shill" && result.shillLink
          ? shillMessage(result.shillLink)
          : null;

    revalidatePath(`/auctions/${itemId}`);
    return {
      ok: false,
      message: explained ?? messages[result.reason] ?? "ซื้อทันทีไม่สำเร็จ",
    };
  }

  revalidatePath(`/auctions/${itemId}`);

  // Straight to the till. Buying outright is a decision to pay NOW, and the
  // 24-hour clock starts the instant this returns — leaving the buyer on the
  // listing to find "ประมูลของฉัน" for themselves spends that clock on
  // navigation. An auction won by outbidding still lands on the listing,
  // because that win arrives while nobody is necessarily looking.
  redirect(`/auctions/${itemId}/pay`);
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
