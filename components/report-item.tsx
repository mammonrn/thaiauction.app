"use client";

import { useActionState, useState } from "react";

import {
  reportItemAction,
  type ReportActionState,
} from "@/app/auctions/[id]/report-actions";
import { MAX_REPORT_NOTE, REPORT_REASONS } from "@/lib/moderation-labels";
import { btnGhost, btnPrimarySm, btnSecondarySm } from "@/lib/button";

const initialState: ReportActionState = { ok: false, message: null };

/**
 * "แจ้งสินค้า" — quiet by design.
 *
 * A ghost link rather than a button: reporting is rare, and a listing page
 * exists to sell the thing, not to invite suspicion of it. The form only
 * appears once someone asks for it.
 *
 * Shown only to a signed-in visitor who is not the seller. Both are re-checked
 * on the server — this only decides whether to render the control.
 */
export function ReportItem({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(reportItemAction, initialState);

  if (state.ok) {
    return (
      <p role="status" className="text-xs text-success">
        {state.message}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
        แจ้งสินค้า
      </button>
    );
  }

  return (
    <form
      action={act}
      className="flex flex-col gap-3 rounded-xl border border-black/10 p-4"
    >
      <input type="hidden" name="itemId" value={itemId} />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">แจ้งสินค้านี้</legend>
        <div className="flex flex-col gap-1.5">
          {REPORT_REASONS.map((reason, index) => (
            <label key={reason.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="reason"
                value={reason.value}
                required
                defaultChecked={index === 0}
                className="accent-brand"
              />
              {reason.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">รายละเอียดเพิ่มเติม (ไม่บังคับ)</span>
        <textarea
          name="note"
          rows={3}
          maxLength={MAX_REPORT_NOTE}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </label>

      {state.message ? (
        <p role="alert" className="text-sm text-brand">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimarySm}>
          {pending ? "กำลังส่ง…" : "ส่งเรื่อง"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={btnSecondarySm}
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
