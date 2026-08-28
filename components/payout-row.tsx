"use client";

import { useActionState } from "react";
import { btnPrimarySm } from "@/lib/button";

import {
  markPaidOutAction,
  type PayoutActionState,
} from "@/app/admin/payouts/actions";

const EMPTY: PayoutActionState = { ok: false, message: null };

/** The "mark as transferred" control, with its bank reference field. */
export function PayoutRow({ paymentId }: { paymentId: string }) {
  const [state, action, pending] = useActionState(markPaidOutAction, EMPTY);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/60">เลขอ้างอิงการโอน</span>
        <input
          name="reference"
          required
          className="rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={btnPrimarySm}
      >
        {pending ? "กำลังบันทึก…" : "ทำเครื่องหมายว่าโอนแล้ว"}
      </button>
      {state.message ? (
        <span
          className={`text-sm ${
            state.ok
              ? "text-green-700"
              : "text-red-600"
          }`}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
