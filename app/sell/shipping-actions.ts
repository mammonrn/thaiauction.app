"use server";

import { revalidatePath } from "next/cache";

import { isAdminEmail } from "@/lib/admin";
import { requireSession } from "@/lib/session";
import {
  markShipped,
  updateTrackingNumber,
  type MarkShippedFailure,
  type ShippingActor,
} from "@/lib/shipping";

export type ShippingActionState = {
  ok: boolean;
  message: string | null;
};

const FAILURES: Record<MarkShippedFailure, string> = {
  // "Not yours" and "does not exist" deliberately read the same, as everywhere
  // else something is addressable by a guessable id.
  not_found: "ไม่พบรายการนี้",
  not_paid: "รายการนี้ยังไม่ได้ชำระเงิน",
  already_shipped: "รายการนี้บันทึกว่าส่งแล้ว",
  no_tracking_number: "กรุณากรอกเลขพัสดุ",
};

/**
 * Who is asking, decided on the server from the session alone.
 *
 * An admin acts as an admin everywhere, including on their own sales — there
 * is no privilege to gain from it, since an admin can already act on anyone's.
 */
function actorFor(user: { id: string; email: string }): ShippingActor {
  return isAdminEmail(user.email)
    ? { kind: "admin" }
    : { kind: "seller", userId: user.id };
}

/** Record the tracking number and mark the order posted. */
export async function markShippedAction(
  _prev: ShippingActionState,
  formData: FormData,
): Promise<ShippingActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const trackingNumber = String(formData.get("trackingNumber") ?? "");
  const { user } = await requireSession("/sell");

  const result = await markShipped(itemId, actorFor(user), trackingNumber);

  revalidatePath("/sell");
  revalidatePath("/account/bids");

  return result.ok
    ? { ok: true, message: null }
    : { ok: false, message: FAILURES[result.reason] };
}

/** Fix a mistyped tracking number without pretending the parcel came back. */
export async function correctTrackingAction(
  _prev: ShippingActionState,
  formData: FormData,
): Promise<ShippingActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const trackingNumber = String(formData.get("trackingNumber") ?? "");
  const { user } = await requireSession("/sell");

  const result = await updateTrackingNumber(itemId, actorFor(user), trackingNumber);

  revalidatePath("/sell");
  revalidatePath("/account/bids");

  return result.ok
    ? { ok: true, message: "แก้เลขพัสดุแล้ว" }
    : { ok: false, message: FAILURES[result.reason] };
}
