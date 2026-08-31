import Image from "next/image";
import Link from "next/link";

import { OfferRow } from "@/components/offer-row";
import { thumbUrl } from "@/lib/image-keys";
import { formatBaht } from "@/lib/money";
import { offersFor } from "@/lib/failed-deal";
import { requireSession } from "@/lib/session";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "ข้อเสนอถึงคุณ" };

/**
 * Items somebody is offering you, at the price you bid.
 *
 * These come from auctions you did not win, where the winner never paid and the
 * seller decided to offer it on. Saying no costs nothing and saying nothing
 * costs nothing — the page says so, because an offer that looks like an
 * obligation is one people avoid answering at all.
 */
export default async function OffersPage() {
  const { user } = await requireSession("/account/offers");
  const offers = await offersFor(user.id);

  return (
    <main className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ข้อเสนอถึงคุณ</h1>
        <p className="text-sm text-ink/60">
          สินค้าที่ผู้ขายเสนอให้คุณในราคาที่คุณเคยเสนอไว้ · ปฏิเสธหรือปล่อยไว้ได้ ไม่มีผลกับบัญชี
        </p>
      </div>

      {offers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 px-5 py-12 text-center">
          <p className="font-medium">ยังไม่มีข้อเสนอ</p>
          <p className="mt-1 text-sm text-ink/60">
            ถ้าผู้ชนะไม่ชำระเงิน ผู้ขายอาจเสนอสินค้าให้คุณที่นี่
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {offers.map((offer) => (
            <li key={offer.id} className="flex flex-col gap-3 rounded-xl bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/5">
                  {offer.auctionItem.images[0] ? (
                    <Image
                      src={thumbUrl(offer.auctionItem.images[0])}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[10px] text-ink/40">
                      ไม่มีรูป
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={`/auctions/${offer.auctionItem.id}`}
                    className="truncate text-sm font-medium text-info underline-offset-4 hover:underline"
                  >
                    {offer.auctionItem.title}
                  </Link>
                  {/* Through lib/money, like every other figure: these are
                      satang, and a raw toLocaleString would print a price a
                      hundred times too big. */}
                  <span className="font-mono text-sm tabular-nums">
                    {formatBaht(offer.amount)}
                  </span>
                  <span className="text-[11px] text-ink/50">
                    ตอบภายใน {formatThaiDateTime(offer.expiresAt)}
                  </span>
                </div>
              </div>

              <OfferRow offerId={offer.id} itemId={offer.auctionItem.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
