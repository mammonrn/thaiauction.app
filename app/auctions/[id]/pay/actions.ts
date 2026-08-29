"use server";

import { revalidatePath } from "next/cache";

import { headers } from "next/headers";

import {
  cancelRedirectAttempt,
  startCardPayment,
  startInstallmentPayment,
  startPromptPayPayment,
  startShopeePayPayment,
  type StartPaymentFailure,
} from "@/lib/payments";
import { requireSession } from "@/lib/session";

export type PayActionState = {
  ok: boolean;
  message: string | null;
  paymentId?: string;
  /** Redirect methods only: where the browser must send the buyer next. */
  authorizeUri?: string;
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
  // Replaced by the bank's own reason, which startCardPayment supplies.
  declined: "บัตรถูกปฏิเสธ กรุณาลองบัตรอื่นหรือชำระด้วย PromptPay",
  method_unavailable: "วิธีชำระเงินนี้ยังไม่เปิดให้บริการ",
  invalid_installment: "แผนผ่อนชำระนี้ใช้กับยอดนี้ไม่ได้ กรุณาเลือกใหม่",
  gateway_error: "ติดต่อระบบชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

/**
 * This site's own origin, for the URL Omise returns the buyer to.
 *
 * Taken from the request rather than from a configured base URL, so a
 * deployment behind a different hostname returns to itself. Only the origin is
 * built here: the path names the payment, which does not exist until the
 * attempt has been reserved, so lib/payments completes it.
 */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "thaiauction.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

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
        result.reason === "declined" && result.message
          ? result.message
          : result.reason === "gateway_error" && result.message
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

/**
 * Pay in instalments.
 *
 * Returns the URL the browser must navigate to; the redirect is done client
 * side rather than with `redirect()` so a failure can be shown in place
 * instead of bouncing the buyer to an error page.
 */
export async function payWithInstallmentAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const bank = String(formData.get("bank") ?? "");
  const term = Number(formData.get("term") ?? 0);
  const { user } = await requireSession(`/auctions/${itemId}/pay`);

  if (!bank || !Number.isInteger(term) || term < 1) {
    return { ok: false, message: FAILURES.invalid_installment };
  }

  const result = await startInstallmentPayment(
    itemId,
    user.id,
    bank,
    term,
    await siteOrigin(),
  );
  revalidatePath(`/auctions/${itemId}/pay`);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "gateway_error" && result.message
          ? `เริ่มผ่อนชำระไม่สำเร็จ: ${result.message}`
          : FAILURES[result.reason],
    };
  }

  return {
    ok: true,
    message: null,
    paymentId: result.paymentId,
    authorizeUri: "authorizeUri" in result ? result.authorizeUri : undefined,
  };
}

/** Pay with ShopeePay. Offered on phones only; the caller says which OS. */
export async function payWithShopeePayAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const platform = String(formData.get("platform") ?? "") === "IOS" ? "IOS" : "ANDROID";
  const { user } = await requireSession(`/auctions/${itemId}/pay`);

  const result = await startShopeePayPayment(
    itemId,
    user.id,
    platform,
    await siteOrigin(),
  );
  revalidatePath(`/auctions/${itemId}/pay`);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "gateway_error" && result.message
          ? `เริ่มชำระผ่าน ShopeePay ไม่สำเร็จ: ${result.message}`
          : FAILURES[result.reason],
    };
  }

  return {
    ok: true,
    message: null,
    paymentId: result.paymentId,
    authorizeUri: "authorizeUri" in result ? result.authorizeUri : undefined,
  };
}

/**
 * Abandon a redirect attempt so another method can be tried.
 *
 * Without this a buyer who backs out of a bank page waits for the charge to
 * expire before the auction will accept a second attempt — 45 minutes for
 * ShopeePay, and for instalments Omise's own seven days, which outlasts the
 * payment deadline entirely.
 */
export async function cancelRedirectAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const { user } = await requireSession(`/auctions/${itemId}/pay`);

  const result = await cancelRedirectAttempt(paymentId, user.id);
  revalidatePath(`/auctions/${itemId}/pay`);

  if (!result.ok) {
    return { ok: false, message: "ยกเลิกรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true, message: null };
}
