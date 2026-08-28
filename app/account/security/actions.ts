"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";

export type SetPasswordState = {
  ok: boolean;
  message: string | null;
};

/**
 * Add a password to an account that currently signs in with Google only.
 *
 * `auth.api.setPassword` is declared with `createAuthEndpoint.serverOnly()` in
 * better-auth 1.7.2, so it is deliberately NOT reachable from the browser
 * client — it has to be called from server code like this action. It creates an
 * `accounts` row with providerId "credential" holding the password hash, and
 * rejects the call if a password is already set.
 *
 * Combined with `emailAndPassword.disableSignUp`, this is the only way a
 * password can enter the system.
 */
export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return { ok: false, message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  }

  if (newPassword.length < 8) {
    return { ok: false, message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" };
  }

  try {
    await auth.api.setPassword({
      body: { newPassword },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      // Surface Better Auth's own validation (too short/long, already set)
      // without leaking anything else.
      return {
        ok: false,
        message: error.message || "ตั้งรหัสผ่านไม่สำเร็จ",
      };
    }

    console.error("[set-password] unexpected failure:", error);
    return { ok: false, message: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/account/security");
  return { ok: true, message: "ตั้งรหัสผ่านเรียบร้อยแล้ว" };
}
