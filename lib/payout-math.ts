import { COMMISSION_PERCENT, type PaymentBreakdown } from "@/lib/payment-math";

/**
 * How a payout is split once Omise's transfer fee is part of the arithmetic.
 *
 * The old split (lib/payment-math.ts) stops at the gateway: the charge tells us
 * `fee`, `fee_vat` and `net`, and the platform takes 10% of `net`. That was
 * complete while an admin moved the money by hand, because a manual bank
 * transfer cost the marketplace nothing per item.
 *
 * Sending it through Omise's Transfers API costs a fee per transfer, and Omise
 * takes that fee OUT OF THE TRANSFER, not out of a separate balance — proven
 * against the TEST API, not read off a doc:
 *
 *     POST /transfers amount=10000 -> fee=1869 fee_vat=131 total_fee=2000
 *                                     net=8000
 *
 * `net` there is what lands in the seller's bank account. So a transfer of
 * exactly `sellerNet` would deliver `sellerNet - total_fee`, and the shortfall
 * would silently be the seller's. The fee is therefore deducted BEFORE the
 * commission is worked out, on the same principle the gateway fee already
 * follows: the platform's 10% is a share of what actually arrived, not of what
 * the buyer typed.
 *
 *     deductedNet = net - transferFee
 *     commission  = 10% of deductedNet, floored
 *     sellerNet   = deductedNet - commission
 *
 * and the marketplace asks Omise to transfer `sellerNet + transferFee`, so that
 * after Omise takes its cut the seller receives `sellerNet` to the satang.
 *
 * Every satang has one place to be:
 *
 *     commission + sellerNet + transferFee + fee + feeVat === amount
 *
 * asserted in scripts/payouts.test.mts over the whole realistic range.
 */

/**
 * Omise's transfer fee, by transfer amount. Integer satang.
 *
 * MEASURED, not quoted. `GET /account` on this very account advertises
 * `transfer_config.fee: "30.00"` and `min_transfer_amount: "30.00"`, and BOTH
 * are wrong about what the API actually does — a transfer of ฿30 is charged
 * ฿20, and ฿20.01 is accepted. Fourteen probes across the range on
 * 2026-08-29 (TEST account acct_68txogtdknxhj312fn0) give exactly two tiers,
 * with the boundary bisected to the satang:
 *
 *     ฿20.01 … ฿2,000,000.00  ->  total_fee ฿20.00   (fee 1869 + VAT 131)
 *     ฿2,000,000.01 and above ->  total_fee ฿150.00  (fee 14019 + VAT 981)
 *
 * The VAT is 7% of the fee, rounded, and Omise picks the fee so the two add to
 * a round total. The tier is a step, not a percentage: ฿30 and ฿2,000,000 are
 * charged the same ฿20.
 *
 * This table is the marketplace's PREDICTION, needed because the commission
 * cannot be worked out without it and Omise quotes no fee until a transfer
 * exists. It is never the last word: `recordTransferResult` compares it with
 * the `total_fee` the API actually returned and rebuilds the split around the
 * real figure when they disagree. A tier change at Omise costs one mispriced
 * payout, which is then corrected from the response rather than persisting.
 */
export const TRANSFER_FEE_TIERS: readonly { upToSatang: number; feeSatang: number }[] = [
  { upToSatang: 200_000_000, feeSatang: 2_000 },
  { upToSatang: Number.POSITIVE_INFINITY, feeSatang: 15_000 },
];

/**
 * The smallest transfer Omise will accept: the amount must be MORE than ฿20.
 *
 * `transfer_config.min_transfer_amount` says ฿30. The API says
 * "amount must be greater than ฿20.00" and accepts 2001 satang, delivering one
 * satang. Both numbers are recorded here because the ฿30 may be what a live
 * account enforces; the guard below uses the one that was observed, and a
 * transfer refused by Omise is handled as a failure either way.
 */
export const MIN_TRANSFER_SATANG = 2_001;

/** Which tier an amount falls in. */
export function transferFeeFor(amountSatang: number): number {
  for (const tier of TRANSFER_FEE_TIERS) {
    if (amountSatang <= tier.upToSatang) return tier.feeSatang;
  }
  return TRANSFER_FEE_TIERS[TRANSFER_FEE_TIERS.length - 1].feeSatang;
}

export type PayoutPlan = {
  /** What reached the marketplace, straight from the charge. */
  net: number;
  /** Omise's fee for moving it on, predicted from the tier table. */
  transferFee: number;
  /** `net - transferFee`: what the commission is a share of. */
  deductedNet: number;
  /** The platform's 10% of `deductedNet`, floored. */
  commission: number;
  /** What must land in the seller's account. */
  sellerNet: number;
  /** What to ASK Omise for, so that `sellerNet` arrives after its fee. */
  transferAmount: number;
};

export type PayoutPlanResult =
  | { ok: true; plan: PayoutPlan }
  /** `net` does not cover the transfer fee plus Omise's floor. */
  | { ok: false; reason: "below_minimum" };

/**
 * Work out a payout from what the charge actually netted.
 *
 * The fee depends on the transfer amount and the transfer amount depends on the
 * fee, so this is a fixed point — but a trivial one, because the amount only
 * ever moves DOWN from `net` and the tiers are a monotone step. Starting at
 * `transferFeeFor(net)` and re-reading the tier at the resulting amount
 * converges in at most one step per tier; the loop is bounded by the tier count
 * rather than trusted to terminate.
 *
 * Refused rather than clamped when the money is too small to move: a payout
 * that delivers less than a satang is not a payout, and quietly transferring
 * the fee to Omise on the seller's behalf would be worse than saying no.
 */
export function planPayout(net: number): PayoutPlanResult {
  let transferFee = transferFeeFor(net);

  for (let attempt = 0; attempt <= TRANSFER_FEE_TIERS.length; attempt++) {
    const deductedNet = net - transferFee;
    if (deductedNet <= 0) return { ok: false, reason: "below_minimum" };

    const commission = Math.floor(deductedNet / (100 / COMMISSION_PERCENT));
    const sellerNet = deductedNet - commission;
    const transferAmount = sellerNet + transferFee;

    const actual = transferFeeFor(transferAmount);
    if (actual === transferFee) {
      if (sellerNet <= 0 || transferAmount < MIN_TRANSFER_SATANG) {
        return { ok: false, reason: "below_minimum" };
      }
      return {
        ok: true,
        plan: { net, transferFee, deductedNet, commission, sellerNet, transferAmount },
      };
    }
    transferFee = actual;
  }

  return { ok: false, reason: "below_minimum" };
}

/** The payout half of a settled charge, as it is written onto the payment row. */
export type PayoutBreakdown = PaymentBreakdown & { transferFee: number };

/**
 * The whole split of a settled charge, transfer fee included.
 *
 * Mirrors `splitPayment` and replaces it while PAYOUT_RECIPIENTS_ENABLED is on,
 * so the statement a seller reads at settlement is the one they are paid to.
 * Returns null when the sale is too small to pay out, which leaves the caller
 * to fall back to the old split rather than write a half-formed row — the money
 * is still owed, it just cannot go out through a transfer.
 */
export function splitPaymentWithTransfer(charge: {
  amount: number;
  fee: number;
  feeVat: number;
  net: number;
}): PayoutBreakdown | null {
  const result = planPayout(charge.net);
  if (!result.ok) return null;

  return {
    amount: charge.amount,
    fee: charge.fee,
    feeVat: charge.feeVat,
    net: charge.net,
    commission: result.plan.commission,
    sellerNet: result.plan.sellerNet,
    transferFee: result.plan.transferFee,
  };
}
