"use server";

import { revalidatePath } from "next/cache";

import { BANK_UNLOCK_MS, isUnlocked } from "@/lib/bank-account";
import { maskPhone, sendChallenge, verifyChallenge } from "@/lib/otp-challenge";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { namesMatch } from "@/lib/thai-name";
import {
  normaliseAccountNumber,
  validateBankAccount,
  type BankAccountErrors,
} from "@/lib/thai-banks";

export type BankActionState = {
  ok: boolean;
  message: string | null;
  errors?: BankAccountErrors;
  values?: { bankCode: string; accountNumber: string; accountName: string };
};

/**
 * Save the account a seller is paid into.
 *
 * Scoped to the caller's own row by construction: the user id comes from the
 * session and is never read from the form, so there is no id to guess.
 *
 * The first save is free — there is nothing to protect yet. Every save after
 * that needs a live unlock, bought with an OTP to a number the seller has
 * already verified. Redirecting a payout is the most valuable thing a stolen
 * session can do here, and a password alone should not be enough for it.
 *
 * The KYC name comparison is RECORDED, not enforced. Thai bank statements
 * carry title prefixes and inconsistent spacing, so a strict match would
 * refuse legitimate accounts; a mismatch is instead flagged for the admin who
 * releases the payout, who can see both names side by side and decide. The
 * flag is recomputed on every save, so a change cannot launder a mismatch into
 * a match by editing around it.
 */
export async function saveBankAccountAction(
  _prev: BankActionState,
  formData: FormData,
): Promise<BankActionState> {
  const { user } = await requireSession("/account/bank");

  const values = {
    bankCode: String(formData.get("bankCode") ?? ""),
    accountNumber: String(formData.get("accountNumber") ?? ""),
    accountName: String(formData.get("accountName") ?? ""),
  };

  const errors = validateBankAccount(values);
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: null, errors, values };
  }

  const [identity, existing] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    }),
    prisma.sellerBankAccount.findUnique({ where: { userId: user.id } }),
  ]);

  // Checked here, not only in the UI: this action is callable directly.
  if (existing && !isUnlocked(existing.unlockedUntil)) {
    return {
      ok: false,
      message:
        "บัญชีธนาคารถูกล็อกไว้ กรุณายืนยัน OTP ที่เบอร์ที่ยืนยันแล้วก่อนแก้ไข",
      values,
    };
  }

  const accountName = values.accountName.trim();
  const matches =
    identity.firstName !== null &&
    identity.lastName !== null &&
    namesMatch(
      { firstName: identity.firstName, lastName: identity.lastName },
      accountName,
    );

  const data = {
    bankCode: values.bankCode,
    accountNumber: normaliseAccountNumber(values.accountNumber),
    accountName,
    nameMatchesKyc: matches,
  };

  if (existing) {
    // The audit and the change land together: a record that can be written
    // without the other is a record that can go missing.
    await prisma.$transaction([
      prisma.bankAccountChange.create({
        data: {
          userId: user.id,
          previousBankCode: existing.bankCode,
          previousAccountNumber: existing.accountNumber,
          previousAccountName: existing.accountName,
          newBankCode: data.bankCode,
          newAccountNumber: data.accountNumber,
          newAccountName: data.accountName,
          newNameMatchesKyc: matches,
          authorisedByPhone: existing.unlockedByPhone ?? "",
        },
      }),
      prisma.sellerBankAccount.update({
        where: { userId: user.id },
        // Spending the unlock is part of the same write: one OTP buys one
        // change, not a window in which any number of changes can happen.
        data: { ...data, unlockedUntil: null, unlockedByPhone: null },
      }),
    ]);
  } else {
    await prisma.sellerBankAccount.create({
      data: { userId: user.id, ...data },
    });
  }

  revalidatePath("/account/bank");
  revalidatePath("/account");

  return {
    ok: true,
    message: matches
      ? "บันทึกบัญชีธนาคารเรียบร้อยแล้ว"
      : "บันทึกแล้ว — แต่ชื่อบัญชีไม่ตรงกับชื่อที่ยืนยันตัวตนไว้ ทีมงานจะตรวจสอบก่อนโอนเงิน ซึ่งอาจทำให้ได้รับเงินช้าลง",
  };
}

export type UnlockActionState = {
  ok: boolean;
  message: string | null;
  /** Set after a code is sent, so the UI can show the code-entry step. */
  sentTo?: string;
  refno?: string;
};

/**
 * Step 1 of changing a saved account — send a code to the verified number.
 *
 * The number comes from the database, never from the form. That is the whole
 * point: a stolen session can type any number it likes into a field, but it
 * cannot make the SMS arrive anywhere except the handset the seller already
 * proved is theirs.
 */
export async function sendBankUnlockOtpAction(
  _prev: UnlockActionState,
): Promise<UnlockActionState> {
  const { user } = await requireSession("/account/bank");

  const phone = await prisma.verifiedPhone.findFirst({
    where: { userId: user.id },
    orderBy: { verifiedAt: "asc" },
    select: { phone: true },
  });

  if (!phone) {
    return {
      ok: false,
      message:
        "ยังไม่มีเบอร์ที่ยืนยันแล้ว — กรุณายืนยันเบอร์โทรศัพท์ก่อน จึงจะเปลี่ยนบัญชีธนาคารได้",
    };
  }

  const sent = await sendChallenge(user.id, phone.phone, "bank_change");
  if (!sent.ok) return { ok: false, message: sent.message };

  return {
    ok: true,
    message: `ส่งรหัส OTP ไปที่ ${maskPhone(phone.phone)} แล้ว`,
    sentTo: maskPhone(phone.phone),
    refno: sent.refno,
  };
}

/**
 * Step 2 — spend the code to open the form for one change.
 *
 * The unlock is a timestamp on the row rather than anything held in the
 * client, so a saved page or a replayed request cannot re-open it: the only
 * thing that opens the form is a database column, and saving clears it.
 */
export async function verifyBankUnlockAction(
  _prev: UnlockActionState,
  formData: FormData,
): Promise<UnlockActionState> {
  const { user } = await requireSession("/account/bank");

  const result = await verifyChallenge(
    user.id,
    "bank_change",
    String(formData.get("pin") ?? "").trim(),
  );
  if (!result.ok) return { ok: false, message: result.message };

  await prisma.sellerBankAccount.update({
    where: { userId: user.id },
    data: {
      unlockedUntil: new Date(Date.now() + BANK_UNLOCK_MS),
      unlockedByPhone: result.phone,
    },
  });

  revalidatePath("/account/bank");
  return { ok: true, message: "ยืนยันแล้ว — แก้ไขบัญชีธนาคารได้ 1 ครั้ง" };
}
