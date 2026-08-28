/**
 * Money helpers.
 *
 * Every price in the database is an integer number of satang (1 baht = 100
 * satang). Integers are exact, so bid comparisons and increments can never
 * drift the way floating-point baht would (0.1 + 0.2 !== 0.3).
 *
 * Convert at the edges only: parse user input with `bahtToSatang`, render with
 * `formatBaht`. Never do arithmetic on the baht representation.
 */

/** 1 baht expressed in satang. */
export const SATANG_PER_BAHT = 100;

/** Convert a baht amount (e.g. from a form field) to integer satang. */
export function bahtToSatang(baht: number): number {
  if (!Number.isFinite(baht)) {
    throw new RangeError(`Invalid baht amount: ${baht}`);
  }
  return Math.round(baht * SATANG_PER_BAHT);
}

/** Convert integer satang back to baht. For display/serialisation only. */
export function satangToBaht(satang: number): number {
  return satang / SATANG_PER_BAHT;
}

/** Format satang as Thai currency, e.g. 150050 -> "฿1,500.50". */
export function formatBaht(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(satangToBaht(satang));
}
