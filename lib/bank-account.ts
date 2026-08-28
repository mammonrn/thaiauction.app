import { bankName } from "@/lib/thai-banks";

/**
 * How long one OTP unlock stays open.
 *
 * Long enough to look up an account number on a banking app, short enough that
 * a phone left on a table is not an open door. Closed early anyway: saving
 * spends the unlock.
 */
export const BANK_UNLOCK_MS = 10 * 60 * 1000;

/** "กสิกรไทย •••5977" — enough to recognise the account, not to use it. */
export function maskBankAccount(bankCode: string, accountNumber: string): string {
  const tail = accountNumber.slice(-4);
  return `${bankName(bankCode)} •••${tail}`;
}

export function isUnlocked(unlockedUntil: Date | null): boolean {
  return unlockedUntil !== null && unlockedUntil.getTime() > Date.now();
}
