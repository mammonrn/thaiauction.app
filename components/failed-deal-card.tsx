"use client";

import Link from "next/link";
import { useActionState } from "react";

import { offerSecondChanceAction, type DealActionState } from "@/app/sell/deal-actions";
import { btnPrimarySm, btnSecondarySm } from "@/lib/button";
import { formatBaht } from "@/lib/money";

/**
 * One deal that fell through, and the two ways out of it.
 *
 * Both are the seller's to take and neither happens on its own — an item is
 * not re-listed or re-offered behind their back. Only one is offered at a time
 * while an offer is live: the same object cannot be promised to a bidder and
 * back on the block at once, so the relist link goes away until the offer is
 * answered or lapses. The server refuses it too; this only stops the seller
 * being shown a button that would be refused.
 *
 * The candidate's PRICE is shown and their identity is not. The seller needs
 * the number to decide; who it is is not theirs to know, and a seller who could
 * see it could go round the marketplace to reach them.
 */
const initialState: DealActionState = { ok: false, message: null };

export function FailedDealCard({
  deal,
  relistHref,
}: {
  deal: {
    itemId: string;
    title: string;
    lastPrice: number;
    /** Set while an offer is out, with the moment it lapses, already formatted. */
    offer: { amount: number; expiresLabel: string } | null;
    /** The next eligible bidder's own bid, or null when there is nobody. */
    candidateAmount: number | null;
  };
  relistHref: string;
}) {
  const [state, formAction, pending] = useActionState(
    offerSecondChanceAction,
    initialState,
  );

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/auctions/${deal.itemId}`}
          className="font-medium text-info underline-offset-4 hover:underline"
        >
          {deal.title}
        </Link>
        <span className="text-xs text-ink/55">
          ราคาที่ปิดไป {formatBaht(deal.lastPrice)} · ไม่มีใครชำระเงิน
        </span>
      </div>

      {deal.offer ? (
        <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">
          ส่งข้อเสนอ {formatBaht(deal.offer.amount)} แล้ว · รอคำตอบถึง{" "}
          {deal.offer.expiresLabel}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {deal.candidateAmount !== null ? (
            <form action={formAction}>
              <input type="hidden" name="itemId" value={deal.itemId} />
              <input type="hidden" name="itemTitle" value={deal.title} />
              <button type="submit" disabled={pending} className={btnPrimarySm}>
                {pending
                  ? "กำลังส่ง…"
                  : `เสนอผู้เสนอราคารายถัดไป ${formatBaht(deal.candidateAmount)}`}
              </button>
            </form>
          ) : null}

          <Link href={relistHref} className={btnSecondarySm}>
            ลงขายใหม่
          </Link>
        </div>
      )}

      {deal.candidateAmount === null && !deal.offer ? (
        <p className="text-xs text-ink/50">
          ไม่มีผู้เสนอราคารายอื่นที่เสนอให้ได้
        </p>
      ) : null}

      {state.message ? (
        <p
          role="status"
          className={`text-xs ${state.ok ? "text-success" : "text-brand"}`}
        >
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
