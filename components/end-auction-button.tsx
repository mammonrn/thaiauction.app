"use client";

import { useActionState, useState } from "react";

import { endAuctionAction, type BidActionState } from "@/app/auctions/[id]/actions";

const initialState: BidActionState = { ok: false, message: null };

/** Seller-only control to close an auction before its time. */
export function EndAuctionButton({
  itemId,
  bidCount,
}: {
  itemId: string;
  bidCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(endAuctionAction, initialState);

  if (state.ok) {
    return (
      <p role="status" className="text-sm text-green-700">
        {state.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-5">
      <h2 className="text-sm font-medium">จบการประมูลก่อนกำหนด</h2>
      <p className="text-sm text-ink/60">
        {bidCount > 0
          ? "ผู้ที่เสนอราคาสูงสุดตอนนี้จะเป็นผู้ชนะทันที"
          : "ยังไม่มีผู้เสนอราคา การจบตอนนี้จะเป็นการยกเลิกรายการ (ไม่มีผู้ชนะ)"}
      </p>

      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          <span className="text-sm">ยืนยัน?</span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60"
          >
            {pending ? "กำลังจบ…" : bidCount > 0 ? "จบและประกาศผู้ชนะ" : "ยกเลิกรายการ"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5"
          >
            ยกเลิก
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5"
        >
          จบประมูลทันที
        </button>
      )}

      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
