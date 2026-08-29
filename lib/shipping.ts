import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Marking a sold item as posted.
 *
 * Manual by design: nothing here talks to a courier. The seller types the
 * tracking number their courier gave them and says they have sent it, and the
 * buyer sees exactly that claim. Two states only — see the ShippingStatus note
 * in the schema for why there is no "delivered".
 *
 * Deliberately NOT in lib/bidding.ts or lib/payments.ts. Shipping happens
 * after the money has moved and cannot affect either, so it has no business
 * sharing a file with the auction's row lock or the charge lifecycle.
 */

export type MarkShippedFailure =
  | "not_found"
  | "not_paid"
  | "already_shipped"
  | "no_tracking_number";

export type MarkShippedResult =
  | { ok: true; trackingNumber: string }
  | { ok: false; reason: MarkShippedFailure };

/** Who is allowed to act on an order's shipping. */
export type ShippingActor =
  /** The seller, acting on their own sale. */
  | { kind: "seller"; userId: string }
  /**
   * An administrator, acting on someone else's. Allowed because sellers mistype
   * tracking numbers and then need a human to fix it; without this the only
   * remedy would be editing the database by hand.
   */
  | { kind: "admin" };

/**
 * Ownership as a WHERE clause, not a comparison after the read.
 *
 * A seller who is not this item's seller matches no row, so "not yours" and
 * "does not exist" are the same answer — the rule the rest of this codebase
 * follows for anything addressable by a guessable id.
 */
function scope(itemId: string, actor: ShippingActor) {
  return actor.kind === "admin"
    ? { id: itemId }
    : { id: itemId, sellerId: actor.userId };
}

/**
 * Record a tracking number and mark the item shipped.
 *
 * One-way. There is no unship: `shippingStatus: "not_shipped"` in the WHERE
 * clause means a second call finds nothing to update, so a double-submitted
 * form cannot overwrite the number the buyer has already been shown. Correcting
 * a wrong number is `updateTrackingNumber`, which is a separate, admin-and-
 * seller-visible edit rather than a silent reversal.
 */
export async function markShipped(
  itemId: string,
  actor: ShippingActor,
  trackingNumberRaw: string,
): Promise<MarkShippedResult> {
  const trackingNumber = trackingNumberRaw.trim();

  // Checked before anything is written: "shipped, tracking number blank" is
  // not a state the buyer can do anything with.
  if (!trackingNumber) {
    return { ok: false, reason: "no_tracking_number" };
  }

  const item = await prisma.auctionItem.findFirst({
    where: scope(itemId, actor),
    select: { id: true, paymentState: true, shippingStatus: true },
  });

  if (!item) return { ok: false, reason: "not_found" };

  // Nothing is posted before it is bought. Without this a seller could mark an
  // item shipped while the buyer's payment deadline was still running.
  if (item.paymentState !== "paid") return { ok: false, reason: "not_paid" };
  if (item.shippingStatus === "shipped") {
    return { ok: false, reason: "already_shipped" };
  }

  const { count } = await prisma.auctionItem.updateMany({
    // The status is part of the WHERE, so two simultaneous submissions cannot
    // both mark it shipped; the second matches nothing.
    where: { ...scope(itemId, actor), paymentState: "paid", shippingStatus: "not_shipped" },
    data: { shippingStatus: "shipped", trackingNumber },
  });

  if (count === 0) return { ok: false, reason: "already_shipped" };
  return { ok: true, trackingNumber };
}

/**
 * Correct the tracking number on an item already marked shipped.
 *
 * The status does not move. Mistyping a tracking number is common and the
 * buyer needs the right one; un-shipping the order to fix it would tell them
 * the parcel had been withdrawn, which is not what happened.
 */
export async function updateTrackingNumber(
  itemId: string,
  actor: ShippingActor,
  trackingNumberRaw: string,
): Promise<MarkShippedResult> {
  const trackingNumber = trackingNumberRaw.trim();
  if (!trackingNumber) return { ok: false, reason: "no_tracking_number" };

  const { count } = await prisma.auctionItem.updateMany({
    where: { ...scope(itemId, actor), shippingStatus: "shipped" },
    data: { trackingNumber },
  });

  if (count === 0) return { ok: false, reason: "not_found" };
  return { ok: true, trackingNumber };
}

/** The delivery address frozen onto an order, or null if none was captured. */
export type ShipToSnapshot = {
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

/**
 * Read the frozen address off an order.
 *
 * Returns null rather than a half-filled object when the snapshot is missing —
 * orders paid before this feature existed have no address, and a seller is
 * better served by "not recorded" than by a partial one they might try to post
 * to.
 */
export function shipToOf(item: {
  shipToName: string | null;
  shipToPhone: string | null;
  shipToLine: string | null;
  shipToSubDistrict: string | null;
  shipToDistrict: string | null;
  shipToProvince: string | null;
  shipToPostalCode: string | null;
}): ShipToSnapshot | null {
  if (
    !item.shipToName ||
    !item.shipToPhone ||
    !item.shipToLine ||
    !item.shipToSubDistrict ||
    !item.shipToDistrict ||
    !item.shipToProvince ||
    !item.shipToPostalCode
  ) {
    return null;
  }
  return {
    recipientName: item.shipToName,
    phone: item.shipToPhone,
    addressLine: item.shipToLine,
    subDistrict: item.shipToSubDistrict,
    district: item.shipToDistrict,
    province: item.shipToProvince,
    postalCode: item.shipToPostalCode,
  };
}

/** One line, the way an address goes on a parcel. */
export function formatShipTo(address: ShipToSnapshot): string {
  return `${address.addressLine} ต.${address.subDistrict} อ.${address.district} จ.${address.province} ${address.postalCode}`;
}

export const SHIPPING_LABEL: Record<"not_shipped" | "shipped", string> = {
  not_shipped: "ยังไม่ส่ง",
  shipped: "ส่งแล้ว",
};
