/**
 * OTP limits.
 *
 * Thaibulksms owns the PIN's own lifetime (its SMS reads "Valid for 5 minutes")
 * and has its own per-number ceiling (ERROR_MSISDN_EXCEEDED_LIMIT). These are
 * this app's limits, applied first, so abuse is stopped before it turns into a
 * billed SMS or a provider-side block.
 */

/** Matches the 5 minutes Thaibulksms states in the SMS it sends. */
export const OTP_TTL_MS = 5 * 60 * 1000;

/** Wrong PINs allowed per challenge before it is burned. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Minimum gap between two sends to the same number. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** Sends allowed to one number per rolling window. */
export const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 60 * 60 * 1000;

/** Thai mobile numbers only — a landline cannot receive the SMS. */
export function isThaiMobile(normalised: string): boolean {
  return /^0[689]\d{8}$/.test(normalised);
}
