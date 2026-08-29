"use client";

import { useActionState, useState } from "react";

import {
  correctTrackingAction,
  markShippedAction,
  type ShippingActionState,
} from "@/app/sell/shipping-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { btnPrimarySm, btnSecondarySm } from "@/lib/button";

const initialState: ShippingActionState = { ok: false, message: null };

export type SoldOrder = {
  itemId: string;
  shippingStatus: "not_shipped" | "shipped";
  trackingNumber: string | null;
  /** One line, ready to copy onto a parcel. Null on orders with no snapshot. */
  shipTo: { recipientName: string; phone: string; line: string } | null;
};

/**
 * What a seller does with an order once it is paid for: read the address, and
 * say they have posted it.
 *
 * Marking shipped confirms first. It cannot be undone — the buyer is shown the
 * tracking number the moment it is set, and there is no "actually, not yet"
 * that would not read to them as the parcel being withdrawn. A mistyped number
 * is corrected in place instead, which is the ordinary case and needs no
 * dialog.
 */
export function ShippingForm({ order }: { order: SoldOrder }) {
  const [shipState, ship, shipping] = useActionState(
    markShippedAction,
    initialState,
  );
  const [fixState, fix, fixing] = useActionState(
    correctTrackingAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);

  const shipped = order.shippingStatus === "shipped";

  return (
    <div className="flex flex-col gap-3 border-t border-black/10 pt-3">
      {order.shipTo ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">
            {order.shipTo.recipientName} · {order.shipTo.phone}
          </span>
          <span className="text-ink/60">{order.shipTo.line}</span>
        </div>
      ) : (
        // Orders paid for before the address was captured. Saying so plainly
        // beats rendering a blank where an address should be.
        <p className="text-xs text-warning">
          ไม่มีที่อยู่จัดส่งในระบบ — ติดต่อผู้ซื้อเพื่อขอที่อยู่
        </p>
      )}

      {shipped ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-success">
            ส่งแล้ว · {order.trackingNumber}
          </p>

          {editing ? (
            <form action={fix} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="itemId" value={order.itemId} />
              <input
                name="trackingNumber"
                defaultValue={order.trackingNumber ?? ""}
                aria-label="เลขพัสดุ"
                className="min-w-0 flex-1 rounded-lg border border-black/15 px-3 py-1.5 text-sm"
              />
              <button type="submit" disabled={fixing} className={btnPrimarySm}>
                {fixing ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={btnSecondarySm}
              >
                ยกเลิก
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${btnSecondarySm} self-start`}
            >
              แก้เลขพัสดุ
            </button>
          )}

          {fixState.message ? (
            <p className={fixState.ok ? "text-xs text-success" : "text-xs text-brand"}>
              {fixState.message}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="เลขพัสดุ"
              aria-label="เลขพัสดุ"
              className="min-w-0 flex-1 rounded-lg border border-black/15 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              // Blocked here as well as on the server: the button that cannot
              // work should not look like it can.
              disabled={shipping || typed.trim() === ""}
              onClick={() => setConfirming(true)}
              className={btnPrimarySm}
            >
              {shipping ? "กำลังบันทึก…" : "ส่งแล้ว"}
            </button>
          </div>

          {/* Submitted by the dialog, so the value confirmed is the value sent. */}
          <form id={`ship-${order.itemId}`} action={ship} className="hidden">
            <input type="hidden" name="itemId" value={order.itemId} />
            <input type="hidden" name="trackingNumber" value={typed} />
          </form>

          <ConfirmDialog
            open={confirming}
            title={`บันทึกว่าส่งแล้ว เลขพัสดุ ${typed.trim()}?`}
            detail="ผู้ซื้อจะเห็นเลขนี้ทันที และย้อนกลับเป็นยังไม่ส่งไม่ได้"
            confirmLabel="ส่งแล้ว"
            tone="primary"
            pending={shipping}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              (
                document.getElementById(`ship-${order.itemId}`) as HTMLFormElement | null
              )?.requestSubmit();
            }}
          />

          {shipState.message ? (
            <p className="text-xs text-brand">{shipState.message}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
