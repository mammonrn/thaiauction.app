import "server-only";

import {
  MAX_SENDS_PER_WINDOW,
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  SEND_WINDOW_MS,
} from "@/lib/otp-policy";
import { prisma } from "@/lib/prisma";
import { requestOtp, ThaibulksmsError, verifyOtp } from "@/lib/thaibulksms";
import type { OtpPurpose } from "@/generated/prisma/enums";

/**
 * Issuing and checking one-time codes, for the flows that are not "prove this
 * new number is yours".
 *
 * Changing a payout account and resetting a password both need the same three
 * things the phone-verification flow needs — a rate limit that runs before any
 * billable SMS, a challenge row, and an attempt-capped check — but neither can
 * reuse app/account/phone/actions.ts: that one refuses a number that is
 * already verified, which is precisely the number these two must send to.
 *
 * Nothing here touches how a code is generated, sent or checked. lib/thaibulksms
 * is called exactly as the phone flow calls it.
 */

export type SendOutcome =
  | { ok: true; refno: string }
  | { ok: false; message: string };

export type VerifyOutcome =
  | { ok: true; phone: string }
  | { ok: false; message: string };

const GENERIC_FAILURE = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

/**
 * Send a code to a number the user has already proved is theirs.
 *
 * The caller resolves the number from the database, never from the form: the
 * whole point of these two flows is that the code goes where the account owner
 * already is, not where a request asks it to go.
 */
export async function sendChallenge(
  userId: string,
  phone: string,
  purpose: OtpPurpose,
): Promise<SendOutcome> {
  const now = new Date();

  // Keyed on the number rather than the account, matching the phone flow: the
  // handset is what receives and is billed for the SMS, so switching accounts
  // must not buy a fresh allowance.
  const [latest, sendsInWindow] = await Promise.all([
    prisma.phoneOtpRequest.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.phoneOtpRequest.count({
      where: {
        phone,
        createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) },
      },
    }),
  ]);

  if (latest) {
    const elapsed = now.getTime() - latest.createdAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return { ok: false, message: `กรุณารอ ${wait} วินาทีก่อนขอรหัสใหม่` };
    }
  }

  if (sendsInWindow >= MAX_SENDS_PER_WINDOW) {
    return {
      ok: false,
      message: "ขอรหัสบ่อยเกินไป กรุณาลองใหม่ในอีก 1 ชั่วโมง",
    };
  }

  let issued;
  try {
    issued = await requestOtp(phone);
  } catch (error) {
    if (error instanceof ThaibulksmsError) {
      if (error.kind === "misconfigured" || error.kind === "no_credit") {
        console.error("[otp] provider configuration/credit problem:", error.kind);
        return { ok: false, message: "ระบบส่ง SMS ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล" };
      }
      return { ok: false, message: error.message };
    }
    console.error("[otp] unexpected send failure:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  await prisma.phoneOtpRequest.create({
    data: {
      userId,
      phone,
      purpose,
      token: issued.token,
      refno: issued.refno,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  });

  return { ok: true, refno: issued.refno };
}

/**
 * Check a code against this user's newest live challenge FOR THIS PURPOSE.
 *
 * The purpose filter is the reason the column exists: without it a code sent
 * to unlock a payout account could be typed into the password-reset form, and
 * one SMS would authorise the other thing too.
 *
 * The provider token is looked up here and never accepted from the caller, and
 * the challenge is consumed on success so it cannot be replayed.
 */
export async function verifyChallenge(
  userId: string,
  purpose: OtpPurpose,
  pin: string,
): Promise<VerifyOutcome> {
  if (!/^\d{6}$/.test(pin)) {
    return { ok: false, message: "กรุณากรอกรหัส 6 หลัก" };
  }

  const challenge = await prisma.phoneOtpRequest.findFirst({
    where: {
      userId,
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return { ok: false, message: "รหัสหมดอายุหรือยังไม่ได้ขอรหัส กรุณาขอรหัสใหม่" };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, message: "กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่" };
  }

  // Counted before the provider call, so a caller that aborts mid-request
  // still spends one of its tries.
  const { attempts } = await prisma.phoneOtpRequest.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

  let correct: boolean;
  try {
    correct = await verifyOtp(challenge.token, pin);
  } catch (error) {
    if (error instanceof ThaibulksmsError) {
      if (error.kind === "expired") {
        return { ok: false, message: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่" };
      }
      if (error.kind === "misconfigured") {
        console.error("[otp] provider misconfigured during verify");
        return { ok: false, message: "ระบบยืนยันไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล" };
      }
      return { ok: false, message: error.message };
    }
    console.error("[otp] unexpected verify failure:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (!correct) {
    const left = Math.max(0, MAX_VERIFY_ATTEMPTS - attempts);
    return {
      ok: false,
      message:
        left > 0
          ? `รหัสไม่ถูกต้อง เหลืออีก ${left} ครั้ง`
          : "กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่",
    };
  }

  await prisma.phoneOtpRequest.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true, phone: challenge.phone };
}

/** "08x-xxx-1234" → "08x-xxx-••34", enough to recognise, not to dial. */
export function maskPhone(phone: string): string {
  if (phone.length < 4) return "••••";
  return `${phone.slice(0, 3)}•••${phone.slice(-4)}`;
}
