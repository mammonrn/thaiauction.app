/**
 * Omise failure codes, in Thai.
 *
 * Omise returns `failure_message` in English ("insufficient funds in the
 * account or the card has reached the credit limit"), which is not much use to
 * a Thai buyer trying to work out what to do next. The code is the stable part
 * of the response, so it is what gets translated; the English message is kept
 * as the fallback for anything not listed, because a message in the wrong
 * language still beats no explanation.
 *
 * Codes observed from the live test API and listed in Omise's docs.
 */
const FAILURES: Record<string, string> = {
  // Cards
  insufficient_fund: "บัตรมีวงเงินไม่พอ หรือถึงวงเงินสูงสุดแล้ว",
  stolen_or_lost_card: "บัตรนี้ถูกแจ้งหายหรือถูกอายัด",
  failed_fraud_check: "ธนาคารปฏิเสธรายการนี้ด้วยเหตุผลด้านความปลอดภัย",
  invalid_security_code: "รหัส CVC หลังบัตรไม่ถูกต้อง",
  invalid_account_number: "หมายเลขบัตรไม่ถูกต้อง",
  expired_card: "บัตรหมดอายุแล้ว",
  failed_processing: "ธนาคารประมวลผลรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  payment_rejected: "ธนาคารผู้ออกบัตรปฏิเสธรายการนี้",
  invalid_card_holder_name: "ชื่อบนบัตรไม่ถูกต้อง",
  // PromptPay and other sources
  insufficient_balance: "ยอดเงินในบัญชีไม่พอ",
  payment_cancelled: "รายการถูกยกเลิก",
  timeout: "หมดเวลาชำระเงิน กรุณาเริ่มใหม่",
};

/** A Thai explanation for a failed charge, falling back to Omise's own words. */
export function failureMessage(
  code: string | null,
  omiseMessage: string | null,
): string {
  if (code && FAILURES[code]) return FAILURES[code];
  return omiseMessage ?? "การชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}
