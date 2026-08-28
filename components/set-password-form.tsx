"use client";

import { useActionState } from "react";
import { btnPrimary } from "@/lib/button";

import {
  setPasswordAction,
  type SetPasswordState,
} from "@/app/account/security/actions";

const initialState: SetPasswordState = { ok: false, message: null };

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setPasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">รหัสผ่านใหม่</span>
        <input
          type="password"
          name="newPassword"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-lg border border-black/15 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">ยืนยันรหัสผ่านใหม่</span>
        <input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-lg border border-black/15 px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={btnPrimary}
      >
        {pending ? "กำลังบันทึก…" : "ตั้งรหัสผ่าน"}
      </button>

      {state.message ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-sm text-green-700"
              : "text-sm text-brand"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
