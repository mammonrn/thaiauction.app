"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  completePasswordResetAction,
  startPasswordResetAction,
  type ResetState,
} from "@/app/forgot-password/actions";
import { btnPrimary } from "@/lib/button";

const EMPTY: ResetState = { ok: false, message: null };

const inputClass = "rounded-lg border border-black/15 px-3 py-2";

/**
 * Reset a password with an SMS code.
 *
 * The two steps are separate actions and separate forms, but the visitor
 * always reaches step two — whether or not the address has an account, and
 * whether or not a code was actually sent. Branching here would undo what the
 * actions are careful to hide.
 */
export function ForgotPasswordForm() {
  const [startState, start, starting] = useActionState(
    startPasswordResetAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-5">
      <form action={start} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">อีเมลของบัญชี</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={startState.email}
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={starting} className={btnPrimary}>
          {starting ? "กำลังส่ง…" : "ส่งรหัส OTP"}
        </button>
      </form>

      {startState.message ? (
        <p
          role="status"
          className={`text-sm ${startState.ok ? "text-ink/70" : "text-brand"}`}
        >
          {startState.message}
        </p>
      ) : null}

      {startState.ok && startState.email ? (
        <NewPasswordStep email={startState.email} />
      ) : null}

      <p className="text-xs leading-relaxed text-ink/50">
        ไม่มีเบอร์ที่ยืนยันไว้?{" "}
        <Link href="/login" className="underline underline-offset-4">
          เข้าสู่ระบบด้วย Google
        </Link>{" "}
        แล้วตั้งรหัสผ่านในหน้าความปลอดภัย
      </p>
    </div>
  );
}

function NewPasswordStep({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    completePasswordResetAction,
    EMPTY,
  );

  if (state.ok) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[.02] p-4">
        <p role="status" className="text-sm text-green-700">
          {state.message}
        </p>
        <Link href="/login" className={`${btnPrimary} self-start`}>
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[.02] p-4"
    >
      <input type="hidden" name="email" value={email} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">รหัส OTP ที่ได้รับทาง SMS</span>
        <input
          name="pin"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className={`${inputClass} font-mono tracking-[0.3em]`}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</span>
        <input
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">ยืนยันรหัสผ่านใหม่</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "กำลังตั้งรหัสผ่าน…" : "ตั้งรหัสผ่านใหม่"}
      </button>

      {state.message ? (
        <p role="status" className="text-sm text-brand">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
