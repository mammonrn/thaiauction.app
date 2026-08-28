/**
 * How long fraud-prevention metadata is kept.
 *
 * IP addresses and User-Agent strings are collected for one purpose — spotting
 * several accounts bidding from one machine — and PDPA's data-minimisation
 * principle says they should not outlive it. Six months is long enough to see
 * a ring that operates across several auctions, and short enough that the
 * database is not a standing archive of where everybody was.
 *
 * The BID ITSELF is never deleted; only these two columns are cleared. A bid
 * is a financial record, its origin is not.
 *
 * Stated in the privacy policy at /privacy, and enforced by
 * scripts/prune-bid-metadata.ts.
 */
export const BID_METADATA_RETENTION_DAYS = 180;
