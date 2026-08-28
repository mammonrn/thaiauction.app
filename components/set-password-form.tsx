"use client";

import { useActionState } from "react";

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
          className="rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-white/5"
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
          className="rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-white/5"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "กำลังบันทึก…" : "ตั้งรหัสผ่าน"}
      </button>

      {state.message ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-sm text-green-700 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
