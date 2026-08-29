"use server";

import { revalidatePath } from "next/cache";

import { markAllRead, markRead } from "@/lib/notifications";
import { requireSession } from "@/lib/session";

export type NotificationActionState = {
  ok: boolean;
  message: string | null;
};

/**
 * Mark one notification read.
 *
 * The session's own id is passed to `markRead`, which puts it in the WHERE
 * clause — so submitting somebody else's notification id matches nothing
 * rather than reading their mail for them.
 */
export async function markReadAction(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const { user } = await requireSession("/account/notifications");
  await markRead(String(formData.get("id") ?? ""), user.id);

  revalidatePath("/account/notifications");
  // The badge lives in the shell, so the whole layout has to be re-read.
  revalidatePath("/", "layout");
  return { ok: true, message: null };
}

/** Clear the badge in one press. */
export async function markAllReadAction(
  _prev: NotificationActionState,
): Promise<NotificationActionState> {
  const { user } = await requireSession("/account/notifications");
  const count = await markAllRead(user.id);

  revalidatePath("/account/notifications");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: count === 0 ? "อ่านครบแล้ว" : `อ่านแล้ว ${count} รายการ`,
  };
}
