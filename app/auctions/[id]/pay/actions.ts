"use server";

import { revalidatePath } from "next/cache";

import {
  startCardPayment,
  startPromptPayPayment,
  type StartPaymentFailure,
} from "@/lib/payments";
import { requireSession } from "@/lib/session";

export type PayActionState = {
  ok: boolean;
  message: string | null;
  paymentId?: string;
};

/**
 * Why an attempt was refused, in words the buyer can act on.
 *
 * `not_winner` deliberately says the same thing as a missing auction: someone
 * probing another person's auction id learns nothing about whether it exists.
 */
const FAILURES: Record<StartPaymentFailure, string> = {
  not_found: "ไม่พบรายการนี้",
  not_winner: "ไม่พบรายการนี้",
  not_due: "รายการนี้ยังไม่ถึงขั้นตอนชำระเงิน",
  deadline_passed:
    "หมดเวลาชำระเงินแล้ว สิทธิ์การซื้อถูกส่งต่อให้ผู้เสนอราคารายถัดไป",
  already_paid: "รายการนี้ชำระเงินเรียบร้อยแล้ว",
  attempt_in_flight:
    "มีรายการชำระเงินที่ยังไม่เสร็จสิ้นอยู่ กรุณาชำระให้เสร็จหรือรอให้ QR หมดอายุก่อนเริ่มใหม่",
  amount_out_of_range:
    "ยอดเงินอยู่นอกช่วงที่ PromptPay รองรับ (฿20 – ฿150,000) กรุณาชำระด้วยบัตรเครดิตแทน",
  gateway_error: "ติดต่อระบบชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

/**
 * Pay by card.
 *
 * The form sends a TOKEN, never card details: Omise.js exchanges the number for
 * it in the browser, against the public key. If a card number ever arrived in
 * this FormData it would mean the client-side script failed, and it still would
 * not be forwarded anywhere — nothing here reads any field but `token`.
 */
export async function payWithCardAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  const { user } = await requireSession(`/auctions/${itemId}/pay`);

  if (!token.startsWith("tokn_")) {
    return { ok: false, message: "ข้อมูลบัตรไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง" };
  }

  const result = await startCardPayment(itemId, user.id, token);
  revalidatePath(`/auctions/${itemId}/pay`);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "gateway_error" && result.message
          ? `ชำระเงินไม่สำเร็จ: ${result.message}`
          : FAILURES[result.reason],
    };
  }

  return { ok: true, message: null, paymentId: result.paymentId };
}

/** Pay by PromptPay: creates the charge whose QR the page then polls. */
export async function payWithPromptPayAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const { user } = await requireSession(`/auctions/${itemId}/pay`);

  const result = await startPromptPayPayment(itemId, user.id);
  revalidatePath(`/auctions/${itemId}/pay`);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "gateway_error" && result.message
          ? `สร้าง QR ไม่สำเร็จ: ${result.message}`
          : FAILURES[result.reason],
    };
  }

  return { ok: true, message: null, paymentId: result.paymentId };
}
