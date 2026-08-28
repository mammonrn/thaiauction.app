"use client";

import { useActionState, useState } from "react";

import {
  deleteDraftAction,
  publishAuctionAction,
  type SellActionState,
} from "@/app/sell/actions";

const initialState: SellActionState = { ok: false, message: null };

export function PublishControls({
  itemId,
  status,
}: {
  itemId: string;
  status: string;
}) {
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
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">เผยแพร่</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          ตอนนี้เป็นฉบับร่าง คนอื่นยังมองไม่เห็น เมื่อเผยแพร่แล้วจะแก้ไขได้จน
          กว่าจะมีคนเสนอราคาคนแรก
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={publish}>
          <input type="hidden" name="itemId" value={itemId} />
          <button
            type="submit"
            disabled={publishing}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {publishing ? "กำลังเผยแพร่…" : "เผยแพร่"}
          </button>
        </form>

        {confirming ? (
          <form action={remove} className="flex items-center gap-2">
            <input type="hidden" name="itemId" value={itemId} />
            <span className="text-sm">ลบฉบับร่างนี้?</span>
            <button
              type="submit"
              disabled={removing}
              className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60 dark:text-red-400"
            >
              {removing ? "กำลังลบ…" : "ลบเลย"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              ยกเลิก
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 dark:text-red-400"
          >
            ลบฉบับร่าง
          </button>
        )}
      </div>

      {publishState.message ? (
        <p
          role="alert"
          className={
            publishState.ok
              ? "text-sm text-green-700 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {publishState.message}
        </p>
      ) : null}
      {deleteState.message && !deleteState.ok ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {deleteState.message}
        </p>
      ) : null}
    </div>
  );
}
