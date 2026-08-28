"use client";

import Image from "next/image";
import { useActionState, useRef, useState } from "react";

import {
  deleteDraftAction,
  publishAuctionAction,
  type SellActionState,
} from "@/app/sell/actions";

const initialState: SellActionState = { ok: false, message: null };

/** Everything the seller should re-read before the listing goes live. */
export type PublishSummary = {
  title: string;
  categoryName: string;
  imageUrls: string[];
  startPrice: string;
  buyNowPrice: string | null;
  bidIncrement: string;
  endTimeLabel: string;
};

export function PublishControls({
  itemId,
  status,
  summary,
}: {
  itemId: string;
  status: string;
  summary: PublishSummary;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [publishState, publish, publishing] = useActionState(
    publishAuctionAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);
  const [deleteState, remove, removing] = useActionState(
    deleteDraftAction,
    initialState,
  );

  if (status !== "draft") return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">เผยแพร่</h2>
        <p className="text-sm text-ink/60">
          ตอนนี้เป็นฉบับร่าง คนอื่นยังมองไม่เห็น เมื่อเผยแพร่แล้วจะแก้ไขได้จน
          กว่าจะมีคนเสนอราคาคนแรก
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Opens the review step rather than publishing straight away: once a
            bid lands the listing can no longer be edited at all, so this is the
            seller's last chance to catch a wrong price or photo. */}
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          เผยแพร่
        </button>

        {confirming ? (
          <form action={remove} className="flex items-center gap-2">
            <input type="hidden" name="itemId" value={itemId} />
            <span className="text-sm">ลบฉบับร่างนี้?</span>
            <button
              type="submit"
              disabled={removing}
              className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60"
            >
              {removing ? "กำลังลบ…" : "ลบเลย"}
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
            className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10"
          >
            ลบฉบับร่าง
          </button>
        )}
      </div>

      {/* Native <dialog>: the platform gives focus trapping, Esc-to-close and
          inertness for free, which a div-based modal has to reimplement. */}
      <dialog
        ref={dialogRef}
        aria-labelledby="publish-confirm-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6">
          <h3 id="publish-confirm-title" className="text-lg font-semibold">
            ตรวจสอบก่อนเผยแพร่
          </h3>
          <p className="text-sm text-ink/60">
            เมื่อมีผู้เสนอราคาแล้วจะแก้ไขรายการนี้ไม่ได้อีก
            กรุณาตรวจสอบให้ครบถ้วน
          </p>

          {summary.imageUrls.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {summary.imageUrls.map((url, index) => (
                <div
                  key={url}
                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-black/10"
                >
                  <Image src={url} alt="" fill sizes="64px" className="object-cover" unoptimized />
                  {index === 0 ? (
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                      ปก
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <dl className="flex flex-col gap-2 text-sm">
            <SummaryRow label="ชื่อสินค้า" value={summary.title} />
            <SummaryRow label="หมวดหมู่" value={summary.categoryName} />
            <SummaryRow label="จำนวนรูป" value={`${summary.imageUrls.length} รูป`} />
            <SummaryRow label="ราคาเริ่มต้น" value={summary.startPrice} />
            <SummaryRow
              label="ราคาซื้อทันที"
              value={summary.buyNowPrice ?? "ไม่กำหนด"}
            />
            <SummaryRow label="ขั้นต่ำการเพิ่มราคา" value={summary.bidIncrement} />
            <SummaryRow label="การจบประมูล" value={summary.endTimeLabel} />
          </dl>

          <div className="flex flex-wrap gap-3 pt-2">
            <form action={publish}>
              <input type="hidden" name="itemId" value={itemId} />
              <button
                type="submit"
                disabled={publishing}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {publishing ? "กำลังเผยแพร่…" : "ยืนยันเผยแพร่"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm transition hover:bg-black/5"
            >
              กลับไปแก้ไข
            </button>
          </div>
        </div>
      </dialog>

      {publishState.message ? (
        <p
          role="alert"
          className={
            publishState.ok
              ? "text-sm text-green-700"
              : "text-sm text-red-600"
          }
        >
          {publishState.message}
        </p>
      ) : null}
      {deleteState.message && !deleteState.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {deleteState.message}
        </p>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-black/5 pb-1.5">
      <dt className="text-ink/60">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
