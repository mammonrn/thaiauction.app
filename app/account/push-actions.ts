"use server";

import { removeSubscription, saveSubscription } from "@/lib/push";
import { requireSession } from "@/lib/session";

export type PushActionState = {
  ok: boolean;
  message: string | null;
};

/**
 * Register this browser for push.
 *
 * The endpoint and keys come from the browser's own PushSubscription, which it
 * got from the push service — there is nothing here worth forging: an attacker
 * submitting someone else's endpoint would only cause their own notifications
 * to be delivered to that person's browser, which the push service will reject
 * anyway because the keys will not match.
 */
export async function subscribePushAction(
  _prev: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const { user } = await requireSession("/account");

  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const p256dh = String(formData.get("p256dh") ?? "").trim();
  const auth = String(formData.get("auth") ?? "").trim();

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, message: "เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่" };
  }

  try {
    await saveSubscription({ userId: user.id, endpoint, p256dh, auth });
  } catch (error) {
    console.error("[push] could not save the subscription:", error);
    return { ok: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }

  return { ok: true, message: "เปิดการแจ้งเตือนแล้ว" };
}

/** Forget this browser. Scoped to the owner. */
export async function unsubscribePushAction(
  _prev: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const { user } = await requireSession("/account");
  const endpoint = String(formData.get("endpoint") ?? "").trim();

  try {
    await removeSubscription(user.id, endpoint);
  } catch (error) {
    console.error("[push] could not remove the subscription:", error);
    return { ok: false, message: "ปิดไม่สำเร็จ กรุณาลองใหม่" };
  }

  return { ok: true, message: "ปิดการแจ้งเตือนแล้ว" };
}
