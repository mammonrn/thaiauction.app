"use client";

import { useActionState } from "react";

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
        <span className="text-black/60 dark:text-white/60">เลขอ้างอิงการโอน</span>
        <input
          name="reference"
          required
          className="rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20 dark:bg-black"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "กำลังบันทึก…" : "ทำเครื่องหมายว่าโอนแล้ว"}
      </button>
      {state.message ? (
        <span
          className={`text-sm ${
            state.ok
              ? "text-green-700 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
