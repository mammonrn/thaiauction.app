"use client";

import { useActionState, useState } from "react";

import {
  removeVerifiedPhoneAction,
  sendOtpAction,
  verifyOtpAction,
  type OtpActionState,
} from "@/app/account/phone/actions";

const initialState: OtpActionState = { ok: false, message: null };

const inputClass =
  "rounded-lg border border-black/15 px-3 py-2";

export function PhoneVerification({
  verified,
  stubMode,
}: {
  verified: { phone: string; verifiedAt: string }[];
  stubMode: boolean;
}) {
  const [sendState, sendAction, sending] = useActionState(
    sendOtpAction,
    initialState,
  );

  // The send step reports which number the code went to; the verify step then
  // works against that number rather than whatever is currently typed.
  const pendingPhone = sendState.ok ? sendState.phone : undefined;

  return (
    <div className="flex flex-col gap-8">
      {stubMode ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          โหมดทดสอบ (OTP_STUB_MODE) — ไม่ส่ง SMS จริง ใช้รหัส{" "}
          <code className="font-mono font-semibold">000000</code>
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">เพิ่มเบอร์ใหม่</h2>
          <p className="text-sm text-ink/60">
            เราจะส่งรหัส 6 หลักไปที่เบอร์นี้ทาง SMS
          </p>
        </div>

        <form action={sendAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">เบอร์มือถือ</span>
            <input
              name="phone"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="08x-xxx-xxxx"
              defaultValue={pendingPhone}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "กำลังส่ง…" : "ขอรหัส OTP"}
          </button>
        </form>

        {sendState.message ? (
          <p
            role="status"
            className={
              sendState.ok
                ? "text-sm text-green-700"
                : "text-sm text-red-600"
            }
          >
            {sendState.message}
            {sendState.ok && sendState.refno
              ? ` (Ref: ${sendState.refno})`
              : null}
          </p>
        ) : null}

        {pendingPhone ? <VerifyStep phone={pendingPhone} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">เบอร์ที่ยืนยันแล้ว</h2>
        {verified.length === 0 ? (
          <p className="text-sm text-ink/60">
            ยังไม่มีเบอร์ที่ยืนยัน
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {verified.map((entry) => (
              <li
                key={entry.phone}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{entry.phone}</span>
                  <span className="text-xs text-ink/50">
                    ยืนยันเมื่อ {entry.verifiedAt}
                  </span>
                </span>
                <RemoveButton phone={entry.phone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function VerifyStep({ phone }: { phone: string }) {
  const [state, action, pending] = useActionState(verifyOtpAction, initialState);

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
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="######"
          className={`${inputClass} max-w-40 font-mono tracking-[0.3em]`}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
        </button>
        {state.message ? (
          <span role="alert" className="text-sm text-red-600">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function RemoveButton({ phone }: { phone: string }) {
  const [confirming, setConfirming] = useState(false);
  const [, action, pending] = useActionState(
    removeVerifiedPhoneAction,
    initialState,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10"
      >
        ลบ
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="phone" value={phone} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60"
      >
        {pending ? "กำลังลบ…" : "ลบเลย"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5"
      >
        ยกเลิก
      </button>
    </form>
  );
}
