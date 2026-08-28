"use client";

import { useActionState, useState } from "react";

import {
  removeVerifiedPhoneAction,
  type OtpActionState,
} from "@/app/account/phone/actions";

import { PhoneOtp } from "@/components/phone-otp";
import { btnDangerSm, btnSecondarySm } from "@/lib/button";

const initialState: OtpActionState = { ok: false, message: null };

export function PhoneVerification({
  verified,
  stubMode,
}: {
  verified: { phone: string; verifiedAt: string }[];
  stubMode: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">เพิ่มเบอร์ใหม่</h2>
          <p className="text-sm text-ink/60">
            เราจะส่งรหัส 6 หลักไปที่เบอร์นี้ทาง SMS
          </p>
        </div>

        {/* The same component the bid dialog uses, so the two can never drift. */}
        <PhoneOtp stubMode={stubMode} />
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
        className={btnDangerSm}
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
        className={btnDangerSm}
      >
        {pending ? "กำลังลบ…" : "ลบเลย"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className={btnSecondarySm}
      >
        ยกเลิก
      </button>
    </form>
  );
}
