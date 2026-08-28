"use server";

import { createLocalAccountIssuer } from "@better-auth/core/db";

import { auth } from "@/lib/auth";
import { sendChallenge, verifyChallenge } from "@/lib/otp-challenge";
import {
  MAX_RESETS_PER_EMAIL,
  MAX_RESETS_PER_IP,
  NEUTRAL_FAILURE_MESSAGE,
  NEUTRAL_SENT_MESSAGE,
  RESET_WINDOW_MS,
  hashEmail,
} from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { requestOrigin } from "@/lib/request-origin";

export type ResetState = {
  ok: boolean;
  message: string | null;
  /** Set once step 1 has run, so the form shows the code + new password step. */
  email?: string;
};

const THROTTLED =
  "ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง";

/**
 * Step 1 — ask for an email, maybe send a code.
 *
 * This action tells the caller nothing. It answers with the same sentence and
 * advances to the same step whether the address has an account, has an account
 * with no verified phone, or has never been seen. A reset form that says "no
 * such user" is a membership oracle, and this site's users are people who buy
 * and sell valuables.
 *
 * What it does NOT hide is rate limiting: a throttle keyed on the address the
 * visitor typed and the address they came from reveals nothing about whether
 * an account exists, and saying so is more useful than a silent failure.
 */
export async function startPasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { ok: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }

  const { ipAddress } = await requestOrigin();
  const emailHash = hashEmail(email);
  const since = new Date(Date.now() - RESET_WINDOW_MS);

  const [byEmail, byIp] = await Promise.all([
    prisma.passwordResetRequest.count({
      where: { emailHash, createdAt: { gte: since } },
    }),
    ipAddress
      ? prisma.passwordResetRequest.count({
          where: { ipAddress, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  if (byEmail >= MAX_RESETS_PER_EMAIL || byIp >= MAX_RESETS_PER_IP) {
    return { ok: false, message: THROTTLED };
  }

  // Recorded before the lookup and for every attempt, including addresses with
  // no account: a throttle that only counts real users would itself be the
  // oracle this flow is built to avoid.
  await prisma.passwordResetRequest.create({ data: { emailHash, ipAddress } });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, verifiedPhones: { select: { phone: true }, take: 1 } },
  });

  const phone = user?.verifiedPhones[0]?.phone;
  if (user && phone) {
    // Any send failure — provider down, per-number cooldown — is swallowed
    // here on purpose. Reporting it would separate "this address exists and
    // is cooling down" from "this address is nothing", which is the exact
    // distinction the flow refuses to make. The user sees a code that never
    // arrives and asks again, which is the same experience as a lost SMS.
    const sent = await sendChallenge(user.id, phone, "password_reset");
    if (!sent.ok) {
      console.warn("[reset] could not send OTP:", sent.message);
    }
  }

  return { ok: true, message: NEUTRAL_SENT_MESSAGE, email };
}

/**
 * Step 2 — spend the code and set the new password.
 *
 * The email arrives from the form, but it proves nothing on its own: the code
 * is checked against the challenge issued to THAT account, so pointing the
 * form at somebody else's address only means their code is required.
 *
 * Every failure — wrong code, expired code, unknown address, an account with
 * no phone — returns one sentence, so this step cannot be used to enumerate
 * either.
 */
export async function completePasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const pin = String(formData.get("pin") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Password rules are checked before the code, so a visitor who mistypes the
  // confirmation is told that rather than burning their one SMS.
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน", email };
  }
  if (newPassword.length < 8) {
    return { ok: false, message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร", email };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return { ok: false, message: NEUTRAL_FAILURE_MESSAGE, email };
  }

  const result = await verifyChallenge(user.id, "password_reset", pin);
  if (!result.ok) {
    return { ok: false, message: NEUTRAL_FAILURE_MESSAGE, email };
  }

  // Written through Better Auth's own adapter rather than straight into the
  // accounts table. `setPassword` is session-bound and cannot be used here, but
  // the row it produces has to be byte-identical to one — the credential
  // sign-in path matches on providerId AND issuer AND accountId, so a
  // hand-rolled row would hash correctly and still fail to sign in.
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  const existing = await ctx.internalAdapter.findCredentialAccount(user.id);

  if (existing) {
    await ctx.internalAdapter.updateAccount(existing.id, { password: hash });
  } else {
    // A Google-only account that has verified a phone gains a password here —
    // the same thing the security page offers someone already signed in.
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      issuer: createLocalAccountIssuer("credential"),
      accountId: user.id,
      password: hash,
    });
  }

  // Whoever held a session before the reset no longer should. If the reset
  // happened because the account was taken over, leaving the attacker signed
  // in would make the whole exercise pointless.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  return {
    ok: true,
    message: "ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่",
  };
}
