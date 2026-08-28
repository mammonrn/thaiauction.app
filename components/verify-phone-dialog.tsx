"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { PhoneOtp } from "@/components/phone-otp";
import { btnGhost, btnPrimary } from "@/lib/button";

/**
 * Verify a number without leaving the auction.
 *
 * Bidding requires a reachable number, and the old copy sent people to
 * "บัญชีของฉัน > เบอร์โทรศัพท์" — three navigations away from the item they
 * were about to bid on, with no way back. The same flow runs here in a dialog
 * and the page refreshes itself when the number is proved, so the bid form is
 * simply there when the dialog closes.
 *
 * A native <dialog> rather than a hand-rolled overlay: it gets focus trapping,
 * Escape-to-close and inertness of the page behind it from the platform.
 */
export function VerifyPhoneDialog({ stubMode }: { stubMode: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const handleVerified = useCallback(() => {
    dialog.current?.close();
    // The bid form is rendered on the server behind this check, so the page
    // has to re-render for it to appear.
    router.refresh();
  }, [router]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={btnPrimary}
      >
        ยืนยันเบอร์โทรเพื่อเสนอราคา
      </button>

      <dialog
        ref={dialog}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-ink backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold">ยืนยันเบอร์โทรศัพท์</h2>
              <p className="text-sm text-ink/60">
                เสนอราคาคือการรับปากว่าจะจ่าย ผู้ขายจึงต้องติดต่อคุณได้จริง
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="ปิด"
              className={`${btnGhost} shrink-0`}
            >
              ✕
            </button>
          </div>

          <PhoneOtp stubMode={stubMode} onVerified={handleVerified} autoFocus />
        </div>
      </dialog>
    </>
  );
}
