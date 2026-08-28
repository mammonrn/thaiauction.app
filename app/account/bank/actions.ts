"use server";

import { revalidatePath } from "next/cache";

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
 * The KYC name comparison is RECORDED, not enforced. Thai bank statements
 * carry title prefixes and inconsistent spacing, so a strict match would
 * refuse legitimate accounts; a mismatch is instead flagged for the admin who
 * releases the payout, who can see both names side by side and decide.
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

  const identity = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { firstName: true, lastName: true },
  });

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

  await prisma.sellerBankAccount.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  revalidatePath("/account/bank");

  return {
    ok: true,
    message: matches
      ? "บันทึกบัญชีธนาคารเรียบร้อยแล้ว"
      : "บันทึกแล้ว — แต่ชื่อบัญชีไม่ตรงกับชื่อที่ยืนยันตัวตนไว้ ทีมงานจะตรวจสอบก่อนโอนเงิน ซึ่งอาจทำให้ได้รับเงินช้าลง",
  };
}
