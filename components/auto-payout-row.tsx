"use client";

import { useActionState, useRef, useState } from "react";

import {
  approvePayoutAction,
  type PayoutActionState,
} from "@/app/admin/payouts/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { btnPrimarySm } from "@/lib/button";
import { formatBaht } from "@/lib/money";

const EMPTY: PayoutActionState = { ok: false, message: null };

/** What Omise says about the seller's account, and what that lets the admin do. */
export type RecipientState = "verified" | "pending" | "failed" | "missing";

/**
 * The one-click payout, and the reason it is sometimes not available.
 *
 * The button is disabled rather than hidden when the seller's account is not
 * ready. A missing control leaves an admin wondering whether the page is
 * broken; a disabled one with the reason beside it answers the question they
 * were about to ask, which is "why can I not pay this person".
 *
 * It confirms first. Money leaving is not reversible from this screen, and the
 * dialog says the figure and the destination — the two things worth checking
 * before the money goes rather than after. `btnPrimary` on the confirm, not
 * `btnDanger`: this is significant, not destructive.
 */
export function AutoPayoutRow({
  paymentId,
  recipient,
  sellerNet,
  accountLabel,
  failureMessage,
}: {
  paymentId: string;
  recipient: RecipientState;
  /** What the seller will receive, after the transfer fee and commission. */
  sellerNet: number;
  /** "กสิกรไทย •••5977", for the confirm dialog. */
  accountLabel: string;
  /** Why the last attempt did not go, when there was one. */
  failureMessage: string | null;
}) {
  const [state, action, pending] = useActionState(approvePayoutAction, EMPTY);
  const [confirming, setConfirming] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const ready = recipient === "verified";

  return (
    <div className="flex flex-col gap-2">
      {failureMessage ? (
        <p className="text-xs text-brand">
          โอนไม่สำเร็จ: {failureMessage} — กดอนุมัติใหม่ได้
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !ready}
          onClick={() => setConfirming(true)}
          className={btnPrimarySm}
        >
          {pending ? "กำลังโอน…" : "อนุมัติโอน"}
        </button>

        {!ready ? (
          <span className="text-xs text-warning">
            {recipient === "missing"
              ? "ผู้ขายยังไม่ได้บันทึกบัญชีธนาคาร"
              : recipient === "failed"
                ? "บัญชีธนาคารของผู้ขายตรวจสอบไม่ผ่าน"
                : "รอผู้ขายยืนยันบัญชีธนาคาร"}
          </span>
        ) : null}

        {state.message ? (
          <span className={state.ok ? "text-sm text-success" : "text-sm text-brand"}>
            {state.message}
          </span>
        ) : null}
      </div>

      <form ref={form} action={action} className="hidden">
        <input type="hidden" name="paymentId" value={paymentId} />
      </form>

      <ConfirmDialog
        open={confirming}
        title="โอนเงินให้ผู้ขาย?"
        detail={`${formatBaht(sellerNet)} เข้า ${accountLabel} — ยกเลิกเองไม่ได้`}
        confirmLabel="โอนเงิน"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          form.current?.requestSubmit();
        }}
      />
    </div>
  );
}
