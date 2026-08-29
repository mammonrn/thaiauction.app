/**
 * Which payment methods are switched on, and what instalment terms to offer.
 *
 * Shared by the server and the browser, so it holds no secrets and imports
 * nothing server-only. The FLAGS are read on the server and passed down as
 * props — an env var read in a client component would be inlined into the
 * bundle at build time and could not be turned off without a rebuild.
 */

/** Omise's own floor for any instalment charge: THB 2,000. From /capability. */
export const INSTALLMENT_MIN_SATANG = 200_000;
/** And its ceiling, shared with PromptPay: THB 150,000. */
export const INSTALLMENT_MAX_SATANG = 15_000_000;

/**
 * The most months this marketplace will offer.
 *
 * first_choice advertises 18, 24 and 36 as well. They are cut deliberately:
 * the buyer pays the interest, and three years of it on a second-hand purchase
 * is not something this marketplace wants to be the reason for.
 */
export const MAX_INSTALLMENT_TERM = 12;

/**
 * Every issuer enabled on the account, with the terms IT offers and the
 * minimum it wants per month.
 *
 * `terms` came from GET /capability on the live account, not from the general
 * documentation — the docs list banks, but the account decides which terms are
 * actually available and they differ per issuer.
 *
 * `minPerMonthSatang` came from Omise's instalment documentation. It matters
 * far more than it looks: Omise enforces it for SCB, TTB and UOB (the source
 * call is refused) but NOT for BAY, BBL, KBANK, KTC or FIRST_CHOICE, where an
 * under-minimum plan is accepted here and then rejected at the bank's own
 * page — after the buyer has been redirected, with the auction's one pending
 * slot already taken. Filtering every issuer ourselves is what stops that.
 */
export type InstallmentBank = {
  /** The Omise source type is `installment_${code}`. */
  code: string;
  name: string;
  terms: number[];
  minPerMonthSatang: number;
};

export const INSTALLMENT_BANKS: InstallmentBank[] = [
  { code: "kbank", name: "กสิกรไทย", terms: [3, 4, 6, 10], minPerMonthSatang: 30_000 },
  { code: "scb", name: "ไทยพาณิชย์", terms: [3, 4, 6, 9, 10], minPerMonthSatang: 50_000 },
  { code: "bay", name: "กรุงศรี", terms: [3, 4, 6, 9, 10], minPerMonthSatang: 50_000 },
  { code: "bbl", name: "กรุงเทพ", terms: [4, 6, 8, 9, 10], minPerMonthSatang: 50_000 },
  { code: "ktc", name: "KTC", terms: [3, 4, 5, 6, 7, 8, 9, 10], minPerMonthSatang: 30_000 },
  { code: "ttb", name: "ทีทีบี", terms: [3, 4, 6, 10], minPerMonthSatang: 50_000 },
  { code: "uob", name: "ยูโอบี", terms: [3, 4, 6, 10], minPerMonthSatang: 50_000 },
  {
    code: "first_choice",
    name: "กรุงศรี เฟิร์สช้อยส์",
    terms: [3, 4, 6, 9, 10, 12],
    minPerMonthSatang: 30_000,
  },
];

export type InstallmentOffer = {
  bank: InstallmentBank;
  /** Terms this amount can actually be split into, cheapest month first. */
  terms: { term: number; perMonthSatang: number }[];
};

/**
 * What can be offered for this amount, per issuer.
 *
 * A term is offered only when the amount divided by it clears that issuer's
 * monthly minimum. Integer division floors, which is the conservative
 * direction: the quoted per-month figure is never higher than what the buyer
 * will actually be asked for.
 *
 * Banks with nothing to offer are dropped entirely rather than shown empty.
 */
export function installmentOffers(amountSatang: number): InstallmentOffer[] {
  if (
    amountSatang < INSTALLMENT_MIN_SATANG ||
    amountSatang > INSTALLMENT_MAX_SATANG
  ) {
    return [];
  }

  return INSTALLMENT_BANKS.map((bank) => ({
    bank,
    terms: bank.terms
      .filter((term) => term <= MAX_INSTALLMENT_TERM)
      .map((term) => ({ term, perMonthSatang: Math.floor(amountSatang / term) }))
      .filter((option) => option.perMonthSatang >= bank.minPerMonthSatang),
  })).filter((offer) => offer.terms.length > 0);
}

/** Whether a (bank, term) pair is one this marketplace actually offered. */
export function isOfferedInstallment(
  amountSatang: number,
  bankCode: string,
  term: number,
): boolean {
  const offer = installmentOffers(amountSatang).find((o) => o.bank.code === bankCode);
  return offer ? offer.terms.some((t) => t.term === term) : false;
}

/**
 * The amount range each gateway-side method actually accepts.
 *
 * Mirrors the PromptPay figures in lib/omise.ts rather than importing them:
 * that module is `server-only`, and this one is shared with the browser so the
 * pay page can decide what to OFFER without a round trip. lib/payments.ts
 * still re-checks PromptPay under the auction's row lock, so these numbers
 * decide presentation, never permission.
 *
 * ShopeePay shares PromptPay's ฿150,000 ceiling. Before this it had no limit
 * here at all: an over-cap auction offered the button, took the tap, and came
 * back with Omise's own English refusal.
 */
export const SHOPEEPAY_MIN_SATANG = 2_000;
export const SHOPEEPAY_MAX_SATANG = 15_000_000;
export const PROMPTPAY_OFFER_MIN_SATANG = 2_000;
export const PROMPTPAY_OFFER_MAX_SATANG = 15_000_000;

export function shopeePayOffered(amountSatang: number): boolean {
  return (
    amountSatang >= SHOPEEPAY_MIN_SATANG &&
    amountSatang <= SHOPEEPAY_MAX_SATANG
  );
}

export function promptPayOffered(amountSatang: number): boolean {
  return (
    amountSatang >= PROMPTPAY_OFFER_MIN_SATANG &&
    amountSatang <= PROMPTPAY_OFFER_MAX_SATANG
  );
}

/**
 * The one line explaining a method the amount has ruled out.
 *
 * Only ever says "this amount is outside its range". A method switched OFF by
 * its flag is never mentioned — the buyer cannot act on that, and the UI
 * states what is true and what you can do, not what the operator has
 * configured. Null when everything the amount allows is on offer, so the note
 * appears only when something is actually missing.
 */
export function amountLimitNote(
  amountSatang: number,
  { shopeePayEnabled }: { shopeePayEnabled: boolean },
): string | null {
  const missing: string[] = [];
  if (!promptPayOffered(amountSatang)) missing.push("PromptPay");
  if (shopeePayEnabled && !shopeePayOffered(amountSatang)) {
    missing.push("ShopeePay");
  }
  if (missing.length === 0) return null;
  return `ยอดนี้อยู่นอกช่วงที่ ${missing.join(" และ ")} รองรับ — ชำระด้วยบัตรเครดิตแทนได้`;
}
