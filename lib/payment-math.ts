/**
 * How a payment is split.
 *
 * Every figure is integer satang, and every figure that Omise can tell us comes
 * from Omise rather than from a formula here. The Charge object carries `fee`,
 * `fee_vat` and `net`, where net is "funding_amount after fees, interest and
 * VAT deducted" — so the platform's cut is taken from `net`, which is what the
 * marketplace actually received, not from what the buyer typed in.
 *
 * No floating point anywhere: 10% is integer division by 10. `0.1 * net` would
 * be inexact for most values and could leave the three figures failing to add
 * back up to `net`.
 */

/** Platform commission, as a percentage of the amount received after fees. */
export const COMMISSION_PERCENT = 10;

export type PaymentBreakdown = {
  /** What the buyer paid: the winning bid. */
  amount: number;
  /** Omise's fee. */
  fee: number;
  /** VAT on Omise's fee. */
  feeVat: number;
  /** What reached the marketplace: amount - fee - feeVat, per Omise. */
  net: number;
  /** The platform's 10%, taken from `net`. */
  commission: number;
  /** What the seller is owed: net - commission. */
  sellerNet: number;
};

/**
 * Split a settled charge.
 *
 * Commission is FLOORED, so a half-satang rounding never falls in the
 * platform's favour, and `sellerNet` is then computed by subtraction rather
 * than by a second percentage — that way commission + sellerNet is exactly
 * `net`, with no satang unaccounted for.
 */
export function splitPayment(charge: {
  amount: number;
  fee: number;
  feeVat: number;
  net: number;
}): PaymentBreakdown {
  const commission = Math.floor(charge.net / (100 / COMMISSION_PERCENT));
  return {
    amount: charge.amount,
    fee: charge.fee,
    feeVat: charge.feeVat,
    net: charge.net,
    commission,
    sellerNet: charge.net - commission,
  };
}
