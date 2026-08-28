"use client";

import { useActionState, useEffect } from "react";
import { btnPrimary } from "@/lib/button";

import {
  sendOtpAction,
  verifyOtpAction,
  type OtpActionState,
} from "@/app/account/phone/actions";

const initialState: OtpActionState = { ok: false, message: null };

const inputClass = "rounded-lg border border-black/15 px-3 py-2";

/**
 * Ask for a number, send a code, take the code back — all in place.
 *
 * Extracted so the identical flow can run wherever a number is needed rather
 * than only on the settings page. Sending someone to another page to verify a
 * number, then expecting them to find their way back to the auction they were
 * bidding on, loses the bid.
 *
 * The Server Actions are used exactly as they were; nothing about how the code
 * is generated, sent or checked changes here.
 */
export function PhoneOtp({
  stubMode,
  onVerified,
  autoFocus,
}: {
  stubMode: boolean;
  onVerified?: () => void;
  autoFocus?: boolean;
}) {
  const [sendState, sendAction, sending] = useActionState(
    sendOtpAction,
    initialState,
  );

  // The send step reports which number the code went to; the verify step then
  // works against that number rather than whatever is currently typed.
  const pendingPhone = sendState.ok ? sendState.phone : undefined;

  return (
    <div className="flex flex-col gap-3">
      {stubMode ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          โหมดทดสอบ (OTP_STUB_MODE) — ไม่ส่ง SMS จริง ใช้รหัส{" "}
          <code className="font-mono font-semibold">000000</code>
        </p>
      ) : null}

      <form action={sendAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">เบอร์มือถือ</span>
          <input
            name="phone"
            required
            inputMode="tel"
            autoComplete="tel"
            autoFocus={autoFocus}
            placeholder="08x-xxx-xxxx"
            defaultValue={pendingPhone}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={sending}
          className={btnPrimary}
        >
          {sending ? "กำลังส่ง…" : "ขอรหัส OTP"}
        </button>
      </form>

      {sendState.message ? (
        <p
          role="status"
          className={
            sendState.ok ? "text-sm text-green-700" : "text-sm text-red-600"
          }
        >
          {sendState.message}
          {sendState.ok && sendState.refno ? ` (Ref: ${sendState.refno})` : null}
        </p>
      ) : null}

      {pendingPhone ? (
        <VerifyStep phone={pendingPhone} onVerified={onVerified} />
      ) : null}
    </div>
  );
}

function VerifyStep({
  phone,
  onVerified,
}: {
  phone: string;
  onVerified?: () => void;
}) {
  const [state, action, pending] = useActionState(verifyOtpAction, initialState);

  // Tell the host once the number is proved, so a page that was waiting on it
  // — the auction page waiting to show a bid form — can refresh itself.
  useEffect(() => {
    if (state.ok) onVerified?.();
  }, [state.ok, onVerified]);

  if (state.ok) {
    return (
      <p role="status" className="text-sm text-green-700">
        {state.message}
      </p>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[.02] p-4"
    >
      <input type="hidden" name="phone" value={phone} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">รหัส OTP ที่ได้รับ</span>
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
      <button
        type="submit"
        disabled={pending}
        className={`${btnPrimary} self-start`}
      >
        {pending ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
      </button>
      {state.message ? (
        <p role="status" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
