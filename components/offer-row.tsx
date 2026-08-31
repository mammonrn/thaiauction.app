"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  acceptOfferAction,
  declineOfferAction,
  type OfferActionState,
} from "@/app/account/offers/actions";
import { btnPrimarySm, btnSecondarySm } from "@/lib/button";

/**
 * Yes or no, on one offer.
 *
 * Two separate forms rather than one with two submits, so each carries its own
 * pending state and neither can be mistaken for the other while it runs.
 *
 * "ปฏิเสธ" is not a destructive action and gets no confirm dialog: nothing is
 * lost by declining an offer the person never asked for, and a confirm on
 * everything trains people to dismiss confirms.
 *
 * Neither answer needs a success message. Accepting redirects to the payment it
 * just created; declining takes the row off the page, which is the same answer
 * said faster. Only a refusal has anything to report.
 */
const initialState: OfferActionState = { ok: false, message: null };

export function OfferRow({ offerId, itemId }: { offerId: string; itemId: string }) {
  const [accepted, accept, accepting] = useActionState(acceptOfferAction, initialState);
  const [declined, decline, declining] = useActionState(declineOfferAction, initialState);
  const state = accepted.message ? accepted : declined;
  const busy = accepting || declining;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={accept}>
          <input type="hidden" name="offerId" value={offerId} />
          <button type="submit" disabled={busy} className={btnPrimarySm}>
            {accepting ? "กำลังรับ…" : "รับข้อเสนอ"}
          </button>
        </form>

        <form action={decline}>
          <input type="hidden" name="offerId" value={offerId} />
          <button type="submit" disabled={busy} className={btnSecondarySm}>
            {declining ? "กำลังส่ง…" : "ปฏิเสธ"}
          </button>
        </form>

        <Link
          href={`/auctions/${itemId}`}
          className="text-xs text-info underline-offset-4 hover:underline"
        >
          ดูสินค้า
        </Link>
      </div>

      {state.message ? (
        <p
          role="status"
          className={`text-xs ${state.ok ? "text-success" : "text-brand"}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
