import "server-only";

import { createHash } from "node:crypto";

/**
 * Limits and helpers for the signed-out password reset.
 *
 * The flow's one hard rule is that it must answer identically whether or not
 * an email has an account — otherwise the form becomes a way to test which of
 * a leaked address list are customers here. Everything in this file exists to
 * keep that true: the throttle is keyed on a HASH of the address so the table
 * itself does not become the answer, and it is written for every attempt so a
 * missing row cannot be read as "no account".
 */

/** Resets allowed per email address, per window. */
export const MAX_RESETS_PER_EMAIL = 3;
/** Resets allowed from one address, per window — a shared office NATs. */
export const MAX_RESETS_PER_IP = 10;
export const RESET_WINDOW_MS = 60 * 60 * 1000;

/** Same address, same hash — different addresses, unlinkable. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * The one answer step 1 gives, whatever happened.
 *
 * Deliberately says "if" rather than "we sent": it is true when the account
 * exists with a verified number, true when it does not, and gives the visitor
 * nothing to distinguish the two.
 */
export const NEUTRAL_SENT_MESSAGE =
  "หากอีเมลนี้มีบัญชีอยู่และผูกเบอร์มือถือที่ยืนยันแล้ว ระบบได้ส่งรหัส OTP ไปยังเบอร์นั้นแล้ว กรุณากรอกรหัสด้านล่าง";

/** Likewise for step 2: one answer for a wrong code, an expired code, an
 *  unknown address and an account with no phone. */
export const NEUTRAL_FAILURE_MESSAGE =
  "รหัสไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบรหัสอีกครั้ง หรือขอรหัสใหม่";
