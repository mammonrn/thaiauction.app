"use client";

import { useActionState, useEffect, useState } from "react";

import { placeBidAction, type BidActionState } from "@/app/auctions/[id]/actions";
import { PriceWindow } from "@/components/price-window";
import { formatBaht, satangToBaht } from "@/lib/money";
import { btnPrimary } from "@/lib/button";

export type AuctionLiveState = {
  currentPrice: number;
  minimumBid: number;
  buyNowPrice: number | null;
  bidCount: number;
  status: "active" | "ended" | "cancelled" | "draft";
  endReason: string | null;
  endTime: string | null;
  endedAt: string | null;
  leader: string | null;
  winner: string | null;
  serverNow: string;
};

const initialAction: BidActionState = { ok: false, message: null };

/** How often the price is refreshed while the tab is visible. */
const POLL_MS = 5000;

const END_REASON_LABEL: Record<string, string> = {
  expired: "หมดเวลาประมูล",
  buy_now: "ขายด้วยราคาซื้อทันที",
  seller_ended: "ผู้ขายจบการประมูลเอง",
  seller_cancelled: "ผู้ขายยกเลิกรายการ",
};

function countdown(endTime: string | null, nowMs: number): string {
  if (!endTime) return "ไม่ระบุเวลาจบ — ผู้ขายเป็นผู้ปิดการประมูล";
  const ms = new Date(endTime).getTime() - nowMs;
  if (ms <= 0) return "หมดเวลาแล้ว";

  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);

  if (days > 0) return `เหลืออีก ${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0) return `เหลืออีก ${hours} ชั่วโมง ${minutes} นาที`;
  return `เหลืออีก ${minutes} นาที ${seconds} วินาที`;
}

export function LiveAuction({
  itemId,
  initial,
  canBid,
  reasonCannotBid,
  bidBlockedAction,
}: {
  itemId: string;
  initial: AuctionLiveState;
  canBid: boolean;
  reasonCannotBid: string | null;
  /// Rendered under the reason when the block is something the visitor can
  /// clear on the spot — verifying a phone number, for instance. Passed in as
  /// a node so this component needs to know nothing about what unblocks it.
  bidBlockedAction?: React.ReactNode;
}) {
  const [state, setState] = useState(initial);
  const [nowMs, setNowMs] = useState(() => new Date(initial.serverNow).getTime());

  // Adopt fresh server props when the page is re-rendered by a Server Action —
  // ending the auction, for instance, happens in a sibling component, so
  // without this the price panel would keep showing "active" until the next
  // poll. React's documented way to adjust state when props change: compare a
  // marker and set during render, not in an effect.
  const [seenServerNow, setSeenServerNow] = useState(initial.serverNow);
  if (initial.serverNow !== seenServerNow) {
    setSeenServerNow(initial.serverNow);
    setState(initial);
    setNowMs(new Date(initial.serverNow).getTime());
  }
  const [bidState, bidAction, bidding] = useActionState(
    placeBidAction,
    initialAction,
  );

  // Poll for other people's bids. Skipped while the tab is hidden, so a
  // forgotten background tab does not keep asking; a refresh happens
  // immediately on return.
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/auctions/${itemId}/state`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const next = (await res.json()) as AuctionLiveState;
        if (!cancelled) {
          setState(next);
          setNowMs(new Date(next.serverNow).getTime());
        }
      } catch {
        // A dropped poll is harmless; the next tick tries again.
      }
    }

    const poll = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [itemId]);

  // Tick the countdown locally between polls, from the server's clock.
  useEffect(() => {
    const tick = setInterval(() => setNowMs((ms) => ms + 1000), 1000);
    return () => clearInterval(tick);
  }, []);

  // A successful bid should show its result at once rather than after the next
  // poll, so pull fresh state immediately.
  useEffect(() => {
    if (!bidState.ok) return;
    let cancelled = false;
    fetch(`/api/auctions/${itemId}/state`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((next) => {
        if (next && !cancelled) setState(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bidState, itemId]);

  const live = state.status === "active";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white p-5">
        <span className="text-sm text-ink/60">
          ราคาปัจจุบัน
        </span>
        <PriceWindow satang={state.currentPrice} size="lg" />
        <span className="text-sm text-ink/60">
          {state.bidCount} การเสนอราคา
          {state.leader ? ` · ผู้เสนอสูงสุด ${state.leader}` : ""}
        </span>
        {state.buyNowPrice !== null && live ? (
          <span className="mt-2 text-sm">
            ซื้อทันทีที่ {formatBaht(state.buyNowPrice)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {live
            ? countdown(state.endTime, nowMs)
            : `จบแล้ว — ${END_REASON_LABEL[state.endReason ?? ""] ?? "ปิดการประมูล"}`}
        </span>
        {!live && state.winner ? (
          <span className="text-sm text-green-700">
            ผู้ชนะ: {state.winner} ที่ {formatBaht(state.currentPrice)}
          </span>
        ) : null}
        {!live && !state.winner ? (
          <span className="text-sm text-ink/60">
            ไม่มีผู้ชนะ (ไม่มีผู้เสนอราคา)
          </span>
        ) : null}
      </div>

      {/* Outside the form on purpose: a buy-now bid ends the auction, which
          unmounts the form. Kept here, the winner still sees the confirmation
          that their purchase went through. */}
      {bidState.message ? (
        <p
          role={bidState.ok ? "status" : "alert"}
          className={
            bidState.ok
              ? "text-sm text-green-700"
              : "text-sm text-red-600"
          }
        >
          {bidState.message}
        </p>
      ) : null}

      {live ? (
        canBid ? (
          <form
            action={bidAction}
            className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5"
          >
            <input type="hidden" name="itemId" value={itemId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">เสนอราคา (บาท)</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                // Prefilled with the smallest acceptable amount, refreshed by
                // polling, so the common case is one tap.
                key={state.minimumBid}
                defaultValue={String(satangToBaht(state.minimumBid))}
                className="rounded-lg border border-black/15 px-3 py-2"
              />
              <span className="text-xs text-ink/60">
                เสนอได้ตั้งแต่ {formatBaht(state.minimumBid)} ขึ้นไป
                {state.buyNowPrice !== null
                  ? ` และไม่เกิน ${formatBaht(state.buyNowPrice)} (ราคาซื้อทันที)`
                  : ""}
              </span>
            </label>
            <button
              type="submit"
              disabled={bidding}
              className={`${btnPrimary} self-start`}
            >
              {bidding ? "กำลังเสนอราคา…" : "เสนอราคา"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-black/20 px-4 py-3">
            <p className="text-sm text-ink/60">{reasonCannotBid}</p>
            {bidBlockedAction}
          </div>
        )
      ) : null}
    </div>
  );
}
