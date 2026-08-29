"use client";

import { useActionState, useRef, useState } from "react";

import { endAuctionAction, type BidActionState } from "@/app/auctions/[id]/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { btnDangerSm } from "@/lib/button";

const initialState: BidActionState = { ok: false, message: null };

/**
 * Seller-only control to close an auction before its time.
 *
 * The consequence — who wins, or that nobody does — is stated in the dialog
 * rather than as standing text under the heading. It is only true at the
 * moment of pressing, and it is the whole reason to stop and read.
 */
export function EndAuctionButton({
  itemId,
  bidCount,
}: {
  itemId: string;
  bidCount: number;
}) {
  const [asking, setAsking] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(endAuctionAction, initialState);

  if (state.ok) {
    return (
      <p role="status" className="text-sm text-green-700">
        {state.message}
      </p>
    );
  }

  const hasBids = bidCount > 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-5">
      <h2 className="text-sm font-medium">จบการประมูลก่อนกำหนด</h2>

      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={pending}
        className={`${btnDangerSm} self-start`}
      >
        {pending ? "กำลังจบ…" : "จบประมูลทันที"}
      </button>

      <form ref={form} action={action} className="hidden">
        <input type="hidden" name="itemId" value={itemId} />
      </form>

      <ConfirmDialog
        open={asking}
        title={hasBids ? "จบและประกาศผู้ชนะ?" : "ยกเลิกรายการนี้?"}
        detail={
          hasBids
            ? "ผู้ที่เสนอราคาสูงสุดตอนนี้จะเป็นผู้ชนะทันที"
            : "ยังไม่มีผู้เสนอราคา จึงไม่มีผู้ชนะ"
        }
        confirmLabel={hasBids ? "จบและประกาศผู้ชนะ" : "ยกเลิกรายการ"}
        pending={pending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          form.current?.requestSubmit();
        }}
      />

      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-brand">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
