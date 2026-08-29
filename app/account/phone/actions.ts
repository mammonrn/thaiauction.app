"use server";

import { revalidatePath } from "next/cache";

import { normalisePhone } from "@/lib/address-validation";
import {
  MAX_SENDS_PER_WINDOW,
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  SEND_WINDOW_MS,
  isThaiMobile,
} from "@/lib/otp-policy";
import { prisma } from "@/lib/prisma";
import { markReferralVerified } from "@/lib/referral";
import { requestOtp, ThaibulksmsError, verifyOtp } from "@/lib/thaibulksms";
import { requireSession } from "@/lib/session";

export type OtpActionState = {
  ok: boolean;
  message: string | null;
  /** Set after a successful send so the UI can show the code-entry step. */
  phone?: string;
  /** Thaibulksms reference shown in the SMS, to match code to request. */
  refno?: string;
};

const GENERIC_FAILURE = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

function readPhone(formData: FormData): string {
  return normalisePhone(String(formData.get("phone") ?? ""));
}

/**
 * Step 1 — send an OTP.
 *
 * Rate limiting runs before the provider call, because every send costs real
 * SMS credit: a spammed form must not be billable.
 */
export async function sendOtpAction(
  _prev: OtpActionState,
  formData: FormData,
): Promise<OtpActionState> {
  const { user } = await requireSession("/account/phone");
  const phone = readPhone(formData);

  if (!isThaiMobile(phone)) {
    return {
      ok: false,
      message: "กรุณากรอกเบอร์มือถือ 10 หลัก (ขึ้นต้น 06 / 08 / 09)",
    };
  }

  const already = await prisma.verifiedPhone.findUnique({
    where: { userId_phone: { userId: user.id, phone } },
    select: { id: true },
  });
  if (already) {
    return { ok: false, message: "เบอร์นี้ยืนยันไปแล้ว" };
  }

  const now = new Date();

  // Rate limits are keyed on the phone number, not the account: the number is
  // what receives (and is billed for) the SMS, so a user cannot bypass them by
  // switching accounts, and one account cannot spam a stranger's handset.
  const [latest, sendsInWindow] = await Promise.all([
    prisma.phoneOtpRequest.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.phoneOtpRequest.count({
      where: { phone, createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) } },
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
      // Operator-side problems must not read as the user's mistake.
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
      userId: user.id,
      phone,
      purpose: "verify_phone",
      token: issued.token,
      refno: issued.refno,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  });

  return {
    ok: true,
    message: "ส่งรหัส OTP แล้ว กรุณาตรวจสอบ SMS",
    phone,
    refno: issued.refno,
  };
}

/**
 * Step 2 — check the PIN.
 *
 * The client sends only the phone and the 6 digits. The provider token is
 * looked up server-side from this user's own newest live challenge, so it can
 * never be supplied or swapped by the caller.
 */
export async function verifyOtpAction(
  _prev: OtpActionState,
  formData: FormData,
): Promise<OtpActionState> {
  const { user } = await requireSession("/account/phone");
  const phone = readPhone(formData);
  const pin = String(formData.get("pin") ?? "").trim();

  if (!/^\d{6}$/.test(pin)) {
    return { ok: false, message: "กรุณากรอกรหัส 6 หลัก", phone };
  }

  const challenge = await prisma.phoneOtpRequest.findFirst({
    where: {
      userId: user.id,
      phone,
      // Only a code asked for THIS purpose counts. Codes sent to unlock a
      // payout account or reset a password go to a number this user has
      // already verified, so without the filter one of those SMS would also
      // satisfy this form.
      purpose: "verify_phone",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return {
      ok: false,
      message: "รหัสหมดอายุหรือยังไม่ได้ขอรหัส กรุณาขอรหัสใหม่",
      phone,
    };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, message: "กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่", phone };
  }

  // Count the attempt before calling out, so a caller that aborts mid-request
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
        return { ok: false, message: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่", phone };
      }
      if (error.kind === "misconfigured") {
        console.error("[otp] provider misconfigured during verify");
        return { ok: false, message: "ระบบยืนยันไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล", phone };
      }
      return { ok: false, message: error.message, phone };
    }
    console.error("[otp] unexpected verify failure:", error);
    return { ok: false, message: GENERIC_FAILURE, phone };
  }

  if (!correct) {
    const left = Math.max(0, MAX_VERIFY_ATTEMPTS - attempts);
    return {
      ok: false,
      message:
        left > 0
          ? `รหัสไม่ถูกต้อง เหลืออีก ${left} ครั้ง`
          : "กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่",
      phone,
    };
  }

  // Consume the challenge and record the number in one transaction, so a
  // verified number can never be written without burning the token that proved
  // it — and the token can never be replayed.
  await prisma.$transaction([
    prisma.phoneOtpRequest.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    prisma.verifiedPhone.upsert({
      where: { userId_phone: { userId: user.id, phone } },
      update: {},
      create: { userId: user.id, phone },
    }),
  ]);

  // If somebody invited this account, their history now says so. Wrapped, and
  // wrapped again inside markReferralVerified: the number IS verified and the
  // row proving it is already committed, so a failure here must not turn a
  // successful verification into an error message.
  try {
    await markReferralVerified(user.id);
  } catch (error) {
    console.error("[referral] verification hook failed:", error);
  }

  revalidatePath("/account/phone");
  revalidatePath("/account");
  return { ok: true, message: "ยืนยันเบอร์โทรศัพท์เรียบร้อยแล้ว", phone };
}

/** Remove a verified number, e.g. after changing SIM. */
export async function removeVerifiedPhoneAction(
  _prev: OtpActionState,
  formData: FormData,
): Promise<OtpActionState> {
  const { user } = await requireSession("/account/phone");
  const phone = readPhone(formData);

  // userId is in the WHERE clause, so another user's row can never be removed.
  await prisma.verifiedPhone.deleteMany({ where: { userId: user.id, phone } });

  revalidatePath("/account/phone");
  revalidatePath("/account");
  return { ok: true, message: "ลบเบอร์ที่ยืนยันแล้วออกเรียบร้อย" };
}
