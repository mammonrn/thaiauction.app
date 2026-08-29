"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { btnPrimary, btnSecondary } from "@/lib/button";

/**
 * What happened, once Omise has been asked.
 *
 * The redirect itself proves nothing, so this polls the same endpoint the pay
 * page polls — which re-reads the charge from Omise on every call. A bank
 * confirms an instalment plan out of band, so `pending` here is normal and
 * common: the buyer may well land back before the bank has told Omise
 * anything.
 *
 * Polling stops as soon as the answer is final, and after two minutes
 * regardless. A page left open on a phone in a pocket should not keep asking.
 */
type State = {
  status: "pending" | "successful" | "failed" | "expired";
  failureMessage: string | null;
};

const POLL_MS = 2_500;
const GIVE_UP_MS = 120_000;

export function PaymentReturn({
  paymentId,
  itemId,
}: {
  paymentId: string;
  itemId: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    let live = true;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch(`/api/payments/${paymentId}/state`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as State;
        if (!live) return;
        setState(body);
        if (body.status !== "pending") return;
      } catch {
        // A dropped connection is not an outcome; the next tick retries.
      }
      if (!live) return;
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setWaited(true);
        return;
      }
      setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      live = false;
    };
  }, [paymentId]);

  if (!state) {
    return <p className="text-sm text-ink/60">กำลังตรวจสอบผลการชำระเงิน…</p>;
  }

  if (state.status === "successful") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-success/35 bg-success/8 p-5">
        <p className="font-semibold text-success">ชำระเงินเรียบร้อยแล้ว</p>
        <Link href={`/auctions/${itemId}`} className={`${btnPrimary} self-start`}>
          กลับไปหน้ารายการ
        </Link>
      </div>
    );
  }

  if (state.status === "pending") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-info/35 bg-info/10 p-5">
        <p className="font-semibold text-info">รอผลจากธนาคาร</p>
        <p className="text-sm text-info/80">
          {waited
            ? "ยังไม่ได้รับผลจากธนาคาร หน้านี้จะอัปเดตเมื่อเปิดใหม่"
            : "หน้านี้จะอัปเดตเองเมื่อได้รับผล"}
        </p>
        {waited ? (
          <Link
            href={`/auctions/${itemId}/pay`}
            className={`${btnSecondary} self-start`}
          >
            กลับไปหน้าชำระเงิน
          </Link>
        ) : null}
      </div>
    );
  }

  // failed or expired: say which, and give the way back to trying again.
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand/[.05] p-5">
      <p className="font-semibold text-brand-dark">
        {state.status === "expired" ? "หมดเวลาชำระเงินรายการนี้" : "ชำระเงินไม่สำเร็จ"}
      </p>
      {state.failureMessage ? (
        <p className="text-sm text-brand-dark/80">{state.failureMessage}</p>
      ) : null}
      <Link href={`/auctions/${itemId}/pay`} className={`${btnPrimary} self-start`}>
        เลือกวิธีชำระเงินใหม่
      </Link>
    </div>
  );
}
